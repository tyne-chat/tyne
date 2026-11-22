// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork (tyne-chat/tyne#873): what the audio player shows besides the sound itself.
//
// `fluxer_fork_audio_extras` opens an audio upload once and
// - hands the bytes of its embedded cover picture (a stream FFmpeg marks AV_DISPOSITION_ATTACHED_PIC:
//   an ID3 APIC frame, a FLAC or Ogg picture block, an MP4 `covr` atom) to `cover_cb`, untouched;
//   the caller cleans them like any image upload;
// - computes its waveform as the web app computes a voice message's
//   (fluxer_app/src/features/voice/utils/VoiceMessageRecordingUtils.ts, buildWaveformBytes): up to 256
//   points, one per 0.1 s of audio, each the RMS of the first channel over its slice, divided by the
//   loudest point, square-rooted and scaled to 0-255.
//
// The waveform decodes every frame of the first audio stream as it streams by, in constant memory: the
// squared samples are summed into at most 4096 buckets, sized from the length the file declares (10 ms
// each for a short file, so a short file's waveform is exactly the web app's), and when a file runs
// longer than it declared, neighbouring buckets merge and each covers twice as much. The buckets are
// grouped into points once the real length is known. It stops at the deadline, and skips a file that
// declares itself longer than `max_seconds` (0: no limit); then, or for a codec outside the allowlist,
// it reports no points and the player shows a plain bar.

#include "native_shim_internal.h"

#define FORK_AUDIO_EXTRAS_AVIO_BUFFER_SIZE (64u * 1024u)
#define FORK_WAVEFORM_MAX_POINTS 256
#define FORK_WAVEFORM_POINT_SECONDS 0.1
#define FORK_WAVEFORM_BUCKETS_PER_SECOND 100
#define FORK_WAVEFORM_BUCKET_CAPACITY 4096

typedef int (*fork_audio_cover_cb)(void *user_data, const void *data, size_t len);

typedef struct {
    struct ff_mem_reader reader;
    AVIOContext *avio;
    AVFormatContext *format;
    long long deadline_monotonic_ms;
} fork_audio_input;

typedef struct {
    double sum_squares[FORK_WAVEFORM_BUCKET_CAPACITY];
    int64_t counts[FORK_WAVEFORM_BUCKET_CAPACITY];
    size_t len;
    int64_t samples;
    int64_t bucket_samples;
} fork_waveform_buckets;

static void fork_audio_input_close(fork_audio_input *input) {
    if (input->format != NULL) avformat_close_input(&input->format);
    if (input->avio != NULL) {
        if (input->avio->buffer != NULL) av_freep(&input->avio->buffer);
        avio_context_free(&input->avio);
    }
}

// The same untrusted-input setup as av_strip.c's static fluxer_av_strip_input_open.
static int fork_audio_input_open(
    fork_audio_input *input,
    const void *media_data,
    size_t media_len,
    long long deadline_monotonic_ms
) {
    memset(input, 0, sizeof(*input));
    if (media_data == NULL || media_len == 0 || deadline_monotonic_ms < 0) {
        return FLUXER_NATIVE_STATUS_CODEC_FAILURE;
    }
    if (media_len > (size_t)INT64_MAX) return FLUXER_NATIVE_STATUS_WORK_LIMIT_EXCEEDED;
    input->deadline_monotonic_ms = deadline_monotonic_ms;
    int status = fluxer_native_deadline_status(deadline_monotonic_ms);
    if (status != FLUXER_NATIVE_STATUS_OK) return status;
    input->reader.data = (const uint8_t *)media_data;
    input->reader.len = media_len;
    unsigned char *buffer = av_malloc(FORK_AUDIO_EXTRAS_AVIO_BUFFER_SIZE);
    if (buffer == NULL) return FLUXER_NATIVE_STATUS_ALLOCATION_FAILED;
    input->avio = avio_alloc_context(
        buffer, FORK_AUDIO_EXTRAS_AVIO_BUFFER_SIZE, 0, &input->reader,
        ff_mem_read_packet, NULL, ff_mem_seek);
    if (input->avio == NULL) {
        av_free(buffer);
        return FLUXER_NATIVE_STATUS_ALLOCATION_FAILED;
    }
    input->format = avformat_alloc_context();
    if (input->format == NULL) return FLUXER_NATIVE_STATUS_ALLOCATION_FAILED;
    status = fluxer_restrict_untrusted_av_context(input->format, FLUXER_AV_INPUT_FORMATS);
    if (status != FLUXER_NATIVE_STATUS_OK) return status;
    av_freep(&input->format->codec_whitelist);
    input->format->codec_whitelist =
        av_strdup(FLUXER_ALLOWED_VIDEO_DECODERS "," FLUXER_ALLOWED_AUDIO_DECODERS);
    if (input->format->codec_whitelist == NULL) return FLUXER_NATIVE_STATUS_ALLOCATION_FAILED;
    input->format->pb = input->avio;
    input->format->interrupt_callback.callback = fluxer_ffmpeg_interrupt_deadline;
    input->format->interrupt_callback.opaque = &input->deadline_monotonic_ms;
    input->format->flags |= AVFMT_FLAG_CUSTOM_IO;
    input->format->probesize = 5 * 1024 * 1024;
    input->format->max_analyze_duration = 5 * AV_TIME_BASE;
    int rc = avformat_open_input(&input->format, NULL, NULL, NULL);
    if (rc < 0) {
        return fluxer_native_status_from_av_error_with_deadline(rc, deadline_monotonic_ms);
    }
    rc = input->format->nb_streams > 0
        ? fluxer_find_stream_info_bounded(input->format)
        : avformat_find_stream_info(input->format, NULL);
    if (rc < 0) {
        return fluxer_native_status_from_av_error_with_deadline(rc, deadline_monotonic_ms);
    }
    if (input->format->nb_streams == 0) return FLUXER_NATIVE_STATUS_CODEC_FAILURE;
    if (input->format->nb_streams > FLUXER_MAX_AV_STREAMS) {
        return FLUXER_NATIVE_STATUS_WORK_LIMIT_EXCEEDED;
    }
    input->format->max_streams = (int)input->format->nb_streams;
    return FLUXER_NATIVE_STATUS_OK;
}

static double fork_waveform_sample(const AVFrame *frame, int index, int channels) {
    enum AVSampleFormat format = (enum AVSampleFormat)frame->format;
    int position = av_sample_fmt_is_planar(format) ? index : index * channels;
    const uint8_t *data = frame->extended_data[0];
    double value;
    switch (av_get_packed_sample_fmt(format)) {
        case AV_SAMPLE_FMT_U8:
            value = ((double)data[position] - 128.0) / 128.0;
            break;
        case AV_SAMPLE_FMT_S16:
            value = (double)((const int16_t *)data)[position] / 32768.0;
            break;
        case AV_SAMPLE_FMT_S32:
            value = (double)((const int32_t *)data)[position] / 2147483648.0;
            break;
        case AV_SAMPLE_FMT_S64:
            value = (double)((const int64_t *)data)[position] / 9223372036854775808.0;
            break;
        case AV_SAMPLE_FMT_FLT:
            value = (double)((const float *)data)[position];
            break;
        case AV_SAMPLE_FMT_DBL:
            value = ((const double *)data)[position];
            break;
        default:
            return 0.0;
    }
    return isfinite(value) ? value : 0.0;
}

// Halves the number of buckets: each new bucket holds two old ones, and covers twice as many samples.
static void fork_waveform_merge(fork_waveform_buckets *buckets) {
    size_t merged = (buckets->len + 1) / 2;
    for (size_t i = 0; i < merged; i++) {
        double sum = buckets->sum_squares[2 * i];
        int64_t count = buckets->counts[2 * i];
        if (2 * i + 1 < buckets->len) {
            sum += buckets->sum_squares[2 * i + 1];
            count += buckets->counts[2 * i + 1];
        }
        buckets->sum_squares[i] = sum;
        buckets->counts[i] = count;
    }
    for (size_t i = merged; i < buckets->len; i++) {
        buckets->sum_squares[i] = 0.0;
        buckets->counts[i] = 0;
    }
    buckets->len = merged;
    buckets->bucket_samples *= 2;
}

static void fork_waveform_add_frame(fork_waveform_buckets *buckets, const AVFrame *frame) {
    int channels = frame->ch_layout.nb_channels > 0 ? frame->ch_layout.nb_channels : 1;
    for (int i = 0; i < frame->nb_samples; i++) {
        int64_t bucket = buckets->samples / buckets->bucket_samples;
        while (bucket >= FORK_WAVEFORM_BUCKET_CAPACITY) {
            fork_waveform_merge(buckets);
            bucket = buckets->samples / buckets->bucket_samples;
        }
        double sample = fork_waveform_sample(frame, i, channels);
        buckets->sum_squares[bucket] += sample * sample;
        buckets->counts[bucket] += 1;
        if ((size_t)bucket + 1 > buckets->len) buckets->len = (size_t)bucket + 1;
        buckets->samples++;
    }
}

// buildWaveformBytes, over the buckets: a bucket belongs to the point its first sample does.
static void fork_waveform_points(const fork_waveform_buckets *buckets, int sample_rate,
                                 unsigned char *out_points, int *out_count) {
    double seconds = (double)buckets->samples / (double)sample_rate;
    int count = (int)ceil(seconds / FORK_WAVEFORM_POINT_SECONDS);
    if (count < 1) count = 1;
    if (count > FORK_WAVEFORM_MAX_POINTS) count = FORK_WAVEFORM_MAX_POINTS;
    int64_t samples_per_point = buckets->samples / count;
    if (samples_per_point < 1) samples_per_point = 1;
    double sums[FORK_WAVEFORM_MAX_POINTS] = {0};
    int64_t counts[FORK_WAVEFORM_MAX_POINTS] = {0};
    for (size_t bucket = 0; bucket < buckets->len; bucket++) {
        int64_t first_sample = (int64_t)bucket * buckets->bucket_samples;
        int64_t point = first_sample / samples_per_point;
        if (point >= count) continue;
        sums[point] += buckets->sum_squares[bucket];
        counts[point] += buckets->counts[bucket];
    }
    double magnitudes[FORK_WAVEFORM_MAX_POINTS] = {0};
    double loudest = 0.0;
    for (int i = 0; i < count; i++) {
        magnitudes[i] = counts[i] > 0 ? sqrt(sums[i] / (double)counts[i]) : 0.0;
        if (magnitudes[i] > loudest) loudest = magnitudes[i];
    }
    for (int i = 0; i < count; i++) {
        double normalised = loudest > 0.0 ? magnitudes[i] / loudest : 0.0;
        if (normalised < 0.0) normalised = 0.0;
        if (normalised > 1.0) normalised = 1.0;
        long value = lround(sqrt(normalised) * 255.0);
        out_points[i] = (unsigned char)(value > 255 ? 255 : value);
    }
    *out_count = count;
}

static int fork_audio_waveform(fork_audio_input *input, int stream_index, double max_seconds,
                               unsigned char *out_points, int *out_count) {
    const AVStream *stream = input->format->streams[stream_index];
    const AVCodec *decoder = avcodec_find_decoder(stream->codecpar->codec_id);
    if (decoder == NULL ||
        av_match_list(decoder->name, FLUXER_ALLOWED_AUDIO_DECODERS, ',') <= 0) {
        return FLUXER_NATIVE_STATUS_UNSUPPORTED;
    }
    int sample_rate = stream->codecpar->sample_rate;
    if (sample_rate <= 0) return FLUXER_NATIVE_STATUS_UNSUPPORTED;
    // A file that says it is longer than the limit is not decoded at all (a second of slack for
    // rounding). The declared length also sizes the buckets, with room to spare: half of them for
    // what the file declares, so that one a little longer needs no merge.
    double declared_seconds = stream->duration != AV_NOPTS_VALUE
        ? (double)stream->duration * av_q2d(stream->time_base)
        : (input->format->duration != AV_NOPTS_VALUE
               ? (double)input->format->duration / (double)AV_TIME_BASE
               : 0.0);
    if (max_seconds > 0.0 && declared_seconds > max_seconds + 1.0) {
        return FLUXER_NATIVE_STATUS_WORK_LIMIT_EXCEEDED;
    }
    fork_waveform_buckets *buckets = av_mallocz(sizeof(*buckets));
    if (buckets == NULL) return FLUXER_NATIVE_STATUS_ALLOCATION_FAILED;
    buckets->bucket_samples = sample_rate / FORK_WAVEFORM_BUCKETS_PER_SECOND;
    if (buckets->bucket_samples < 1) buckets->bucket_samples = 1;
    if (declared_seconds > 0.0) {
        int64_t declared_samples = (int64_t)ceil(declared_seconds * (double)sample_rate);
        int64_t sized = (declared_samples + FORK_WAVEFORM_BUCKET_CAPACITY / 2 - 1) /
                        (FORK_WAVEFORM_BUCKET_CAPACITY / 2);
        if (sized > buckets->bucket_samples) buckets->bucket_samples = sized;
    }
    AVCodecContext *context = avcodec_alloc_context3(decoder);
    AVPacket *packet = av_packet_alloc();
    AVFrame *frame = av_frame_alloc();
    int rc = context == NULL || packet == NULL || frame == NULL ? AVERROR(ENOMEM) : 0;
    if (rc == 0) rc = avcodec_parameters_to_context(context, stream->codecpar);
    if (rc == 0) {
        context->pkt_timebase = stream->time_base;
        context->thread_count = 1;
        rc = avcodec_open2(context, decoder, NULL);
    }
    int status = FLUXER_NATIVE_STATUS_OK;
    int draining = 0;
    while (rc >= 0 && status == FLUXER_NATIVE_STATUS_OK) {
        status = fluxer_native_deadline_status(input->deadline_monotonic_ms);
        if (status != FLUXER_NATIVE_STATUS_OK) break;
        if (!draining) {
            int read_rc = av_read_frame(input->format, packet);
            if (read_rc == AVERROR_EOF) {
                draining = 1;
                avcodec_send_packet(context, NULL);
            } else if (read_rc < 0) {
                rc = read_rc;
                break;
            } else {
                if (packet->stream_index == stream_index) avcodec_send_packet(context, packet);
                av_packet_unref(packet);
            }
        }
        for (;;) {
            int receive_rc = avcodec_receive_frame(context, frame);
            if (receive_rc < 0) {
                if (draining || receive_rc == AVERROR_EOF) rc = AVERROR_EOF;
                break;
            }
            fork_waveform_add_frame(buckets, frame);
            av_frame_unref(frame);
        }
    }
    avcodec_free_context(&context);
    av_packet_free(&packet);
    av_frame_free(&frame);
    if (status == FLUXER_NATIVE_STATUS_OK && rc < 0 && rc != AVERROR_EOF) {
        status = fluxer_native_status_from_av_error_with_deadline(rc, input->deadline_monotonic_ms);
    }
    if (status == FLUXER_NATIVE_STATUS_OK && buckets->samples > 0) {
        fork_waveform_points(buckets, sample_rate, out_points, out_count);
    } else if (status == FLUXER_NATIVE_STATUS_OK) {
        status = FLUXER_NATIVE_STATUS_UNSUPPORTED;
    }
    av_free(buckets);
    return status;
}

// Returns the status of opening the input. The cover goes to `cover_cb` (when it returns non-zero,
// the cover is skipped); the waveform's own status goes to `out_waveform_status`, with its points in
// `out_points` (room for 256) and their number in `out_count` (0 when there is none).
int fluxer_fork_audio_extras(
    const void *media_data,
    size_t media_len,
    long long deadline_monotonic_ms,
    double max_waveform_seconds,
    fork_audio_cover_cb cover_cb,
    void *cover_user_data,
    unsigned char *out_points,
    int *out_count,
    int *out_waveform_status
) {
    if (out_points == NULL || out_count == NULL || out_waveform_status == NULL) {
        return FLUXER_NATIVE_STATUS_CODEC_FAILURE;
    }
    *out_count = 0;
    *out_waveform_status = FLUXER_NATIVE_STATUS_UNSUPPORTED;
    fork_audio_input input;
    int status = fork_audio_input_open(&input, media_data, media_len, deadline_monotonic_ms);
    if (status != FLUXER_NATIVE_STATUS_OK) {
        fork_audio_input_close(&input);
        return status;
    }
    int audio_index = -1;
    for (unsigned int i = 0; i < input.format->nb_streams; i++) {
        const AVStream *stream = input.format->streams[i];
        if (stream == NULL || stream->codecpar == NULL) continue;
        if (ff_stream_is_attached_picture(stream)) {
            const AVPacket *picture = &stream->attached_pic;
            if (cover_cb != NULL && picture->data != NULL && picture->size > 0) {
                cover_cb(cover_user_data, picture->data, (size_t)picture->size);
                cover_cb = NULL;
            }
        } else if (audio_index < 0 && stream->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) {
            audio_index = (int)i;
        }
    }
    if (audio_index >= 0) {
        *out_waveform_status =
            fork_audio_waveform(&input, audio_index, max_waveform_seconds, out_points, out_count);
    }
    fork_audio_input_close(&input);
    return FLUXER_NATIVE_STATUS_OK;
}

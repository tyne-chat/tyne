import type { GenEnum, GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import { enumDesc, fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";

/**
 * Describes the file fluxer/user/preferences/v1/accessibility.proto.
 */
export const file_fluxer_user_preferences_v1_accessibility: GenFile = /*@__PURE__*/
  fileDesc("Ci5mbHV4ZXIvdXNlci9wcmVmZXJlbmNlcy92MS9hY2Nlc3NpYmlsaXR5LnByb3RvEhpmbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MSLxJgoVQWNjZXNzaWJpbGl0eVNldHRpbmdzEiIKFHNob3dfcGVyc29uYXNfYnV0dG9uGK0RIAEoCEgAiAEBEjEKI3Nob3dfbWVzc2FnZV9hY3Rpb25fYmFyX2NvcHlfYnV0dG9uGK4RIAEoCEgBiAEBEiUKF3Nob3dfYWx0X3RleHRfb25faW1hZ2VzGK8RIAEoCEgCiAEBEh4KEG1vYmlsZV9mb250X3NpemUYsBEgASgBSAOIAQESKgocbW9iaWxlX21lc3NhZ2VfZ3JvdXBfc3BhY2luZxixESABKAFIBIgBARIyCiRtb2JpbGVfY29tcGFjdF9tZXNzYWdlX2dyb3VwX3NwYWNpbmcYshEgASgBSAWIAQESHgoRc2F0dXJhdGlvbl9mYWN0b3IYASABKAFIBogBARIeChZhbHdheXNfdW5kZXJsaW5lX2xpbmtzGAIgASgIEiIKFWVuYWJsZV90ZXh0X3NlbGVjdGlvbhgDIAEoCEgHiAEBEiUKGHNob3dfbWVzc2FnZV9zZW5kX2J1dHRvbhgEIAEoCEgIiAEBEiUKGHNob3dfdGV4dGFyZWFfZm9jdXNfcmluZxgFIAEoCEgJiAEBEhsKE2hpZGVfa2V5Ym9hcmRfaGludHMYBiABKAgSJwoaZXNjYXBlX2V4aXRzX2tleWJvYXJkX21vZGUYByABKAhICogBARIsCh9zeW5jX3JlZHVjZWRfbW90aW9uX3dpdGhfc3lzdGVtGAggASgISAuIAQESJAoXcmVkdWNlZF9tb3Rpb25fb3ZlcnJpZGUYCSABKAhIDIgBARIiChVtZXNzYWdlX2dyb3VwX3NwYWNpbmcYCiABKAFIDYgBARIbCg5tZXNzYWdlX2d1dHRlchgLIAEoAUgOiAEBEhYKCWZvbnRfc2l6ZRgMIAEoAUgPiAEBEi4KIXNob3dfdXNlcl9hdmF0YXJzX2luX2NvbXBhY3RfbW9kZRgNIAEoCEgQiAEBEisKI21vYmlsZV9zdGlja2VyX2FuaW1hdGlvbl9vdmVycmlkZGVuGA4gASgIEiYKHm1vYmlsZV9naWZfYXV0b3BsYXlfb3ZlcnJpZGRlbhgPIAEoCBInCh9tb2JpbGVfYW5pbWF0ZV9lbW9qaV9vdmVycmlkZGVuGBAgASgIEisKHm1vYmlsZV9zdGlja2VyX2FuaW1hdGlvbl92YWx1ZRgRIAEoBUgRiAEBEiYKGW1vYmlsZV9naWZfYXV0b3BsYXlfdmFsdWUYEiABKAhIEogBARInChptb2JpbGVfYW5pbWF0ZV9lbW9qaV92YWx1ZRgTIAEoCEgTiAEBEiEKFGF1dG9fc2VuZF9rbGlweV9naWZzGBQgASgISBSIAQESHAoPc2hvd19naWZfYnV0dG9uGBUgASgISBWIAQESHgoRc2hvd19tZW1lc19idXR0b24YFiABKAhIFogBARIhChRzaG93X3N0aWNrZXJzX2J1dHRvbhgXIAEoCEgXiAEBEh4KEXNob3dfZW1vamlfYnV0dG9uGBggASgISBiIAQESJwoac2hvd19tZWRpYV9mYXZvcml0ZV9idXR0b24YGSABKAhIGYgBARInChpzaG93X21lZGlhX2Rvd25sb2FkX2J1dHRvbhgaIAEoCEgaiAEBEiUKGHNob3dfbWVkaWFfZGVsZXRlX2J1dHRvbhgbIAEoCEgbiAEBEigKG3Nob3dfc3VwcHJlc3NfZW1iZWRzX2J1dHRvbhgcIAEoCEgciAEBEh8KEnNob3dfZ2lmX2luZGljYXRvchgdIAEoCEgdiAEBEi0KIHNob3dfYXR0YWNobWVudF9leHBpcnlfaW5kaWNhdG9yGB4gASgISB6IAQESXQodY2hhbm5lbF90eXBpbmdfaW5kaWNhdG9yX21vZGUYICABKA4yNi5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5DaGFubmVsVHlwaW5nSW5kaWNhdG9yTW9kZRIzCiZzaG93X3NlbGVjdGVkX2NoYW5uZWxfdHlwaW5nX2luZGljYXRvchghIAEoCEgfiAEBEiQKF3Nob3dfbWVzc2FnZV9hY3Rpb25fYmFyGCIgASgISCCIAQESNAonc2hvd19tZXNzYWdlX2FjdGlvbl9iYXJfcXVpY2tfcmVhY3Rpb25zGCMgASgISCGIAQESMQokc2hvd19tZXNzYWdlX2FjdGlvbl9iYXJfc2hpZnRfZXhwYW5kGCQgASgISCKIAQESNQooc2hvd19tZXNzYWdlX2FjdGlvbl9iYXJfb25seV9tb3JlX2J1dHRvbhglIAEoCEgjiAEBEjAKI3Nob3dfZGVmYXVsdF9lbW9qaXNfaW5fYXV0b2NvbXBsZXRlGCYgASgISCSIAQESLwoic2hvd19jdXN0b21fZW1vamlzX2luX2F1dG9jb21wbGV0ZRgnIAEoCEgliAEBEioKHXNob3dfc3RpY2tlcnNfaW5fYXV0b2NvbXBsZXRlGCggASgISCaIAQESJwoac2hvd19tZW1lc19pbl9hdXRvY29tcGxldGUYKSABKAhIJ4gBARI1Cih2b2ljZV9jaGFubmVsX2pvaW5fcmVxdWlyZXNfZG91YmxlX2NsaWNrGCwgASgISCiIAQESHQoQY3VzdG9tX3RoZW1lX2NzcxgtIAEoCUgpiAEBEhsKDnNob3dfZmF2b3JpdGVzGC4gASgISCqIAQESFwoKem9vbV9sZXZlbBgvIAEoAUgriAEBElEKF2RtX21lc3NhZ2VfcHJldmlld19tb2RlGDAgASgOMjAuZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuRG1NZXNzYWdlUHJldmlld01vZGUSHwoSZW5hYmxlX3R0c19jb21tYW5kGDEgASgISCyIAQESFQoIdHRzX3JhdGUYMiABKAFILYgBARIwCiNzaG93X2ZhZGVkX3VucmVhZF9vbl9tdXRlZF9jaGFubmVscxgzIAEoCEguiAEBEigKG3Nob3dfY29udGV4dF9tZW51X3Nob3J0Y3V0cxg0IAEoCEgviAEBEioKHWNvbmZpcm1fYmVmb3JlX3N0YXJ0aW5nX2NhbGxzGDUgASgISDCIAQESRAoQaGRyX2Rpc3BsYXlfbW9kZRg2IAEoDjIqLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkhkckRpc3BsYXlNb2RlEiAKE3ByZXNlcnZlX2VkaXRfZHJhZnQYNyABKAhIMYgBARIsCh9zdGF5X2ludGVyYWN0aXZlX3doZW5fdW5mb2N1c2VkGDggASgISDKIAQESMgolY29uZmlybV9iZWZvcmVfam9pbmluZ192b2ljZV9jaGFubmVscxg5IAEoCEgziAEBEjAKI3NjcmVlbl9yZWFkZXJfYW5ub3VuY2VfbmV3X21lc3NhZ2VzGDogASgISDSIAQESNAonZmlyc3RfY2xpY2tfcGFzc190aHJvdWdoX3doZW5fdW5mb2N1c2VkGDsgASgISDWIAQESKgodY29tcGFjdF9tZXNzYWdlX2dyb3VwX3NwYWNpbmcYPCABKAFINogBARItCiBzY3JvbGxfdG9fYm90dG9tX29uX21lc3NhZ2Vfc2VuZBg9IAEoCEg3iAEBEiMKFmRpbV9zdHJpa2V0aHJvdWdoX3RleHQYPiABKAhIOIgBARIhChRzZXF1ZW50aWFsX2ZpbGVfc2VuZBg/IAEoCEg5iAEBEikKHG1vYmlsZV9zcGxhc2hfem9vbV9hbmltYXRpb24YQCABKAhIOogBARIpChxtZXNzYWdlX2RvdWJsZV9jbGlja19hY3Rpb25zGEIgASgISDuIAQESKwoeYW5ub3VuY2VfY2FsbF9qb2luc19hbmRfbGVhdmVzGEMgASgISDyIAQFCFwoVX3Nob3dfcGVyc29uYXNfYnV0dG9uQiYKJF9zaG93X21lc3NhZ2VfYWN0aW9uX2Jhcl9jb3B5X2J1dHRvbkIaChhfc2hvd19hbHRfdGV4dF9vbl9pbWFnZXNCEwoRX21vYmlsZV9mb250X3NpemVCHwodX21vYmlsZV9tZXNzYWdlX2dyb3VwX3NwYWNpbmdCJwolX21vYmlsZV9jb21wYWN0X21lc3NhZ2VfZ3JvdXBfc3BhY2luZ0IUChJfc2F0dXJhdGlvbl9mYWN0b3JCGAoWX2VuYWJsZV90ZXh0X3NlbGVjdGlvbkIbChlfc2hvd19tZXNzYWdlX3NlbmRfYnV0dG9uQhsKGV9zaG93X3RleHRhcmVhX2ZvY3VzX3JpbmdCHQobX2VzY2FwZV9leGl0c19rZXlib2FyZF9tb2RlQiIKIF9zeW5jX3JlZHVjZWRfbW90aW9uX3dpdGhfc3lzdGVtQhoKGF9yZWR1Y2VkX21vdGlvbl9vdmVycmlkZUIYChZfbWVzc2FnZV9ncm91cF9zcGFjaW5nQhEKD19tZXNzYWdlX2d1dHRlckIMCgpfZm9udF9zaXplQiQKIl9zaG93X3VzZXJfYXZhdGFyc19pbl9jb21wYWN0X21vZGVCIQofX21vYmlsZV9zdGlja2VyX2FuaW1hdGlvbl92YWx1ZUIcChpfbW9iaWxlX2dpZl9hdXRvcGxheV92YWx1ZUIdChtfbW9iaWxlX2FuaW1hdGVfZW1vamlfdmFsdWVCFwoVX2F1dG9fc2VuZF9rbGlweV9naWZzQhIKEF9zaG93X2dpZl9idXR0b25CFAoSX3Nob3dfbWVtZXNfYnV0dG9uQhcKFV9zaG93X3N0aWNrZXJzX2J1dHRvbkIUChJfc2hvd19lbW9qaV9idXR0b25CHQobX3Nob3dfbWVkaWFfZmF2b3JpdGVfYnV0dG9uQh0KG19zaG93X21lZGlhX2Rvd25sb2FkX2J1dHRvbkIbChlfc2hvd19tZWRpYV9kZWxldGVfYnV0dG9uQh4KHF9zaG93X3N1cHByZXNzX2VtYmVkc19idXR0b25CFQoTX3Nob3dfZ2lmX2luZGljYXRvckIjCiFfc2hvd19hdHRhY2htZW50X2V4cGlyeV9pbmRpY2F0b3JCKQonX3Nob3dfc2VsZWN0ZWRfY2hhbm5lbF90eXBpbmdfaW5kaWNhdG9yQhoKGF9zaG93X21lc3NhZ2VfYWN0aW9uX2JhckIqCihfc2hvd19tZXNzYWdlX2FjdGlvbl9iYXJfcXVpY2tfcmVhY3Rpb25zQicKJV9zaG93X21lc3NhZ2VfYWN0aW9uX2Jhcl9zaGlmdF9leHBhbmRCKwopX3Nob3dfbWVzc2FnZV9hY3Rpb25fYmFyX29ubHlfbW9yZV9idXR0b25CJgokX3Nob3dfZGVmYXVsdF9lbW9qaXNfaW5fYXV0b2NvbXBsZXRlQiUKI19zaG93X2N1c3RvbV9lbW9qaXNfaW5fYXV0b2NvbXBsZXRlQiAKHl9zaG93X3N0aWNrZXJzX2luX2F1dG9jb21wbGV0ZUIdChtfc2hvd19tZW1lc19pbl9hdXRvY29tcGxldGVCKwopX3ZvaWNlX2NoYW5uZWxfam9pbl9yZXF1aXJlc19kb3VibGVfY2xpY2tCEwoRX2N1c3RvbV90aGVtZV9jc3NCEQoPX3Nob3dfZmF2b3JpdGVzQg0KC196b29tX2xldmVsQhUKE19lbmFibGVfdHRzX2NvbW1hbmRCCwoJX3R0c19yYXRlQiYKJF9zaG93X2ZhZGVkX3VucmVhZF9vbl9tdXRlZF9jaGFubmVsc0IeChxfc2hvd19jb250ZXh0X21lbnVfc2hvcnRjdXRzQiAKHl9jb25maXJtX2JlZm9yZV9zdGFydGluZ19jYWxsc0IWChRfcHJlc2VydmVfZWRpdF9kcmFmdEIiCiBfc3RheV9pbnRlcmFjdGl2ZV93aGVuX3VuZm9jdXNlZEIoCiZfY29uZmlybV9iZWZvcmVfam9pbmluZ192b2ljZV9jaGFubmVsc0ImCiRfc2NyZWVuX3JlYWRlcl9hbm5vdW5jZV9uZXdfbWVzc2FnZXNCKgooX2ZpcnN0X2NsaWNrX3Bhc3NfdGhyb3VnaF93aGVuX3VuZm9jdXNlZEIgCh5fY29tcGFjdF9tZXNzYWdlX2dyb3VwX3NwYWNpbmdCIwohX3Njcm9sbF90b19ib3R0b21fb25fbWVzc2FnZV9zZW5kQhkKF19kaW1fc3RyaWtldGhyb3VnaF90ZXh0QhcKFV9zZXF1ZW50aWFsX2ZpbGVfc2VuZEIfCh1fbW9iaWxlX3NwbGFzaF96b29tX2FuaW1hdGlvbkIfCh1fbWVzc2FnZV9kb3VibGVfY2xpY2tfYWN0aW9uc0IhCh9fYW5ub3VuY2VfY2FsbF9qb2luc19hbmRfbGVhdmVzSgQIHxAgSgQIKhArSgQIKxAsSgQIQRBCUiJ1c2VfYnJvd3Nlcl9sb2NhbGVfZm9yX3RpbWVfZm9ybWF0Uh9hdHRhY2htZW50X21lZGlhX2RpbWVuc2lvbl9zaXplUhplbWJlZF9tZWRpYV9kaW1lbnNpb25fc2l6ZVIcZG91YmxlX2NsaWNrX21lc3NhZ2VfYWN0aW9ucyJxChZBY2Nlc3NpYmlsaXR5T3ZlcnJpZGVzEhoKEmdpZl9hdXRvcGxheV9kaXJ0eRgBIAEoCBIbChNhbmltYXRlX2Vtb2ppX2RpcnR5GAIgASgIEh4KFmFuaW1hdGVfc3RpY2tlcnNfZGlydHkYAyABKAgq0gEKGkNoYW5uZWxUeXBpbmdJbmRpY2F0b3JNb2RlEi0KKUNIQU5ORUxfVFlQSU5HX0lORElDQVRPUl9NT0RFX1VOU1BFQ0lGSUVEEAASKQolQ0hBTk5FTF9UWVBJTkdfSU5ESUNBVE9SX01PREVfQVZBVEFSUxABEjAKLENIQU5ORUxfVFlQSU5HX0lORElDQVRPUl9NT0RFX0lORElDQVRPUl9PTkxZEAISKAokQ0hBTk5FTF9UWVBJTkdfSU5ESUNBVE9SX01PREVfSElEREVOEAMqqwEKFERtTWVzc2FnZVByZXZpZXdNb2RlEicKI0RNX01FU1NBR0VfUFJFVklFV19NT0RFX1VOU1BFQ0lGSUVEEAASHwobRE1fTUVTU0FHRV9QUkVWSUVXX01PREVfQUxMEAESJwojRE1fTUVTU0FHRV9QUkVWSUVXX01PREVfVU5SRUFEX09OTFkQAhIgChxETV9NRVNTQUdFX1BSRVZJRVdfTU9ERV9OT05FEAMqbAoOSGRyRGlzcGxheU1vZGUSIAocSERSX0RJU1BMQVlfTU9ERV9VTlNQRUNJRklFRBAAEhkKFUhEUl9ESVNQTEFZX01PREVfRlVMTBABEh0KGUhEUl9ESVNQTEFZX01PREVfU1RBTkRBUkQQAmIGcHJvdG8z");

/**
 * @generated from message fluxer.user.preferences.v1.AccessibilitySettings
 */
export type AccessibilitySettings = Message<"fluxer.user.preferences.v1.AccessibilitySettings"> & {
  /**
   * Fork fields. The fork numbers its own fields from 2200 up, in this block; never give a
   * fork field the next number after upstream's last one. Upstream numbers its fields in
   * sequence, and the settings are stored by number, so a fork field in that range is read
   * as upstream's next field once upstream adds it (field 65 did that on 2026-10-16).
   *
   * @generated from field: optional bool show_personas_button = 2221;
   */
  showPersonasButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_message_action_bar_copy_button = 2222;
   */
  showMessageActionBarCopyButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_alt_text_on_images = 2223;
   */
  showAltTextOnImages?: boolean | undefined;

  /**
   * @generated from field: optional double mobile_font_size = 2224;
   */
  mobileFontSize?: number | undefined;

  /**
   * @generated from field: optional double mobile_message_group_spacing = 2225;
   */
  mobileMessageGroupSpacing?: number | undefined;

  /**
   * @generated from field: optional double mobile_compact_message_group_spacing = 2226;
   */
  mobileCompactMessageGroupSpacing?: number | undefined;

  /**
   * @generated from field: optional double saturation_factor = 1;
   */
  saturationFactor?: number | undefined;

  /**
   * @generated from field: bool always_underline_links = 2;
   */
  alwaysUnderlineLinks: boolean;

  /**
   * @generated from field: optional bool enable_text_selection = 3;
   */
  enableTextSelection?: boolean | undefined;

  /**
   * @generated from field: optional bool show_message_send_button = 4;
   */
  showMessageSendButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_textarea_focus_ring = 5;
   */
  showTextareaFocusRing?: boolean | undefined;

  /**
   * @generated from field: bool hide_keyboard_hints = 6;
   */
  hideKeyboardHints: boolean;

  /**
   * @generated from field: optional bool escape_exits_keyboard_mode = 7;
   */
  escapeExitsKeyboardMode?: boolean | undefined;

  /**
   * @generated from field: optional bool sync_reduced_motion_with_system = 8;
   */
  syncReducedMotionWithSystem?: boolean | undefined;

  /**
   * @generated from field: optional bool reduced_motion_override = 9;
   */
  reducedMotionOverride?: boolean | undefined;

  /**
   * @generated from field: optional double message_group_spacing = 10;
   */
  messageGroupSpacing?: number | undefined;

  /**
   * @generated from field: optional double message_gutter = 11;
   */
  messageGutter?: number | undefined;

  /**
   * @generated from field: optional double font_size = 12;
   */
  fontSize?: number | undefined;

  /**
   * @generated from field: optional bool show_user_avatars_in_compact_mode = 13;
   */
  showUserAvatarsInCompactMode?: boolean | undefined;

  /**
   * @generated from field: bool mobile_sticker_animation_overridden = 14;
   */
  mobileStickerAnimationOverridden: boolean;

  /**
   * @generated from field: bool mobile_gif_autoplay_overridden = 15;
   */
  mobileGifAutoplayOverridden: boolean;

  /**
   * @generated from field: bool mobile_animate_emoji_overridden = 16;
   */
  mobileAnimateEmojiOverridden: boolean;

  /**
   * @generated from field: optional int32 mobile_sticker_animation_value = 17;
   */
  mobileStickerAnimationValue?: number | undefined;

  /**
   * @generated from field: optional bool mobile_gif_autoplay_value = 18;
   */
  mobileGifAutoplayValue?: boolean | undefined;

  /**
   * @generated from field: optional bool mobile_animate_emoji_value = 19;
   */
  mobileAnimateEmojiValue?: boolean | undefined;

  /**
   * Fork: optional, so that a missing value reads as on (tyne-chat/tyne#536). Same wire format.
   *
   * @generated from field: optional bool auto_send_klipy_gifs = 20;
   */
  autoSendKlipyGifs?: boolean | undefined;

  /**
   * @generated from field: optional bool show_gif_button = 21;
   */
  showGifButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_memes_button = 22;
   */
  showMemesButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_stickers_button = 23;
   */
  showStickersButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_emoji_button = 24;
   */
  showEmojiButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_media_favorite_button = 25;
   */
  showMediaFavoriteButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_media_download_button = 26;
   */
  showMediaDownloadButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_media_delete_button = 27;
   */
  showMediaDeleteButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_suppress_embeds_button = 28;
   */
  showSuppressEmbedsButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_gif_indicator = 29;
   */
  showGifIndicator?: boolean | undefined;

  /**
   * @generated from field: optional bool show_attachment_expiry_indicator = 30;
   */
  showAttachmentExpiryIndicator?: boolean | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.ChannelTypingIndicatorMode channel_typing_indicator_mode = 32;
   */
  channelTypingIndicatorMode: ChannelTypingIndicatorMode;

  /**
   * @generated from field: optional bool show_selected_channel_typing_indicator = 33;
   */
  showSelectedChannelTypingIndicator?: boolean | undefined;

  /**
   * @generated from field: optional bool show_message_action_bar = 34;
   */
  showMessageActionBar?: boolean | undefined;

  /**
   * @generated from field: optional bool show_message_action_bar_quick_reactions = 35;
   */
  showMessageActionBarQuickReactions?: boolean | undefined;

  /**
   * @generated from field: optional bool show_message_action_bar_shift_expand = 36;
   */
  showMessageActionBarShiftExpand?: boolean | undefined;

  /**
   * @generated from field: optional bool show_message_action_bar_only_more_button = 37;
   */
  showMessageActionBarOnlyMoreButton?: boolean | undefined;

  /**
   * @generated from field: optional bool show_default_emojis_in_autocomplete = 38;
   */
  showDefaultEmojisInAutocomplete?: boolean | undefined;

  /**
   * @generated from field: optional bool show_custom_emojis_in_autocomplete = 39;
   */
  showCustomEmojisInAutocomplete?: boolean | undefined;

  /**
   * @generated from field: optional bool show_stickers_in_autocomplete = 40;
   */
  showStickersInAutocomplete?: boolean | undefined;

  /**
   * @generated from field: optional bool show_memes_in_autocomplete = 41;
   */
  showMemesInAutocomplete?: boolean | undefined;

  /**
   * @generated from field: optional bool voice_channel_join_requires_double_click = 44;
   */
  voiceChannelJoinRequiresDoubleClick?: boolean | undefined;

  /**
   * @generated from field: optional string custom_theme_css = 45;
   */
  customThemeCss?: string | undefined;

  /**
   * @generated from field: optional bool show_favorites = 46;
   */
  showFavorites?: boolean | undefined;

  /**
   * @generated from field: optional double zoom_level = 47;
   */
  zoomLevel?: number | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.DmMessagePreviewMode dm_message_preview_mode = 48;
   */
  dmMessagePreviewMode: DmMessagePreviewMode;

  /**
   * @generated from field: optional bool enable_tts_command = 49;
   */
  enableTtsCommand?: boolean | undefined;

  /**
   * @generated from field: optional double tts_rate = 50;
   */
  ttsRate?: number | undefined;

  /**
   * @generated from field: optional bool show_faded_unread_on_muted_channels = 51;
   */
  showFadedUnreadOnMutedChannels?: boolean | undefined;

  /**
   * @generated from field: optional bool show_context_menu_shortcuts = 52;
   */
  showContextMenuShortcuts?: boolean | undefined;

  /**
   * @generated from field: optional bool confirm_before_starting_calls = 53;
   */
  confirmBeforeStartingCalls?: boolean | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.HdrDisplayMode hdr_display_mode = 54;
   */
  hdrDisplayMode: HdrDisplayMode;

  /**
   * @generated from field: optional bool preserve_edit_draft = 55;
   */
  preserveEditDraft?: boolean | undefined;

  /**
   * @generated from field: optional bool stay_interactive_when_unfocused = 56;
   */
  stayInteractiveWhenUnfocused?: boolean | undefined;

  /**
   * @generated from field: optional bool confirm_before_joining_voice_channels = 57;
   */
  confirmBeforeJoiningVoiceChannels?: boolean | undefined;

  /**
   * @generated from field: optional bool screen_reader_announce_new_messages = 58;
   */
  screenReaderAnnounceNewMessages?: boolean | undefined;

  /**
   * @generated from field: optional bool first_click_pass_through_when_unfocused = 59;
   */
  firstClickPassThroughWhenUnfocused?: boolean | undefined;

  /**
   * @generated from field: optional double compact_message_group_spacing = 60;
   */
  compactMessageGroupSpacing?: number | undefined;

  /**
   * @generated from field: optional bool scroll_to_bottom_on_message_send = 61;
   */
  scrollToBottomOnMessageSend?: boolean | undefined;

  /**
   * @generated from field: optional bool dim_strikethrough_text = 62;
   */
  dimStrikethroughText?: boolean | undefined;

  /**
   * @generated from field: optional bool sequential_file_send = 63;
   */
  sequentialFileSend?: boolean | undefined;

  /**
   * @generated from field: optional bool mobile_splash_zoom_animation = 64;
   */
  mobileSplashZoomAnimation?: boolean | undefined;

  /**
   * @generated from field: optional bool message_double_click_actions = 66;
   */
  messageDoubleClickActions?: boolean | undefined;

  /**
   * @generated from field: optional bool announce_call_joins_and_leaves = 67;
   */
  announceCallJoinsAndLeaves?: boolean | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.AccessibilitySettings.
 * Use `create(AccessibilitySettingsSchema)` to create a new message.
 */
export const AccessibilitySettingsSchema: GenMessage<AccessibilitySettings> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_accessibility, 0);

/**
 * @generated from message fluxer.user.preferences.v1.AccessibilityOverrides
 */
export type AccessibilityOverrides = Message<"fluxer.user.preferences.v1.AccessibilityOverrides"> & {
  /**
   * @generated from field: bool gif_autoplay_dirty = 1;
   */
  gifAutoplayDirty: boolean;

  /**
   * @generated from field: bool animate_emoji_dirty = 2;
   */
  animateEmojiDirty: boolean;

  /**
   * @generated from field: bool animate_stickers_dirty = 3;
   */
  animateStickersDirty: boolean;
};

/**
 * Describes the message fluxer.user.preferences.v1.AccessibilityOverrides.
 * Use `create(AccessibilityOverridesSchema)` to create a new message.
 */
export const AccessibilityOverridesSchema: GenMessage<AccessibilityOverrides> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_accessibility, 1);

/**
 * @generated from enum fluxer.user.preferences.v1.ChannelTypingIndicatorMode
 */
export enum ChannelTypingIndicatorMode {
  /**
   * @generated from enum value: CHANNEL_TYPING_INDICATOR_MODE_UNSPECIFIED = 0;
   */
  UNSPECIFIED = 0,

  /**
   * @generated from enum value: CHANNEL_TYPING_INDICATOR_MODE_AVATARS = 1;
   */
  AVATARS = 1,

  /**
   * @generated from enum value: CHANNEL_TYPING_INDICATOR_MODE_INDICATOR_ONLY = 2;
   */
  INDICATOR_ONLY = 2,

  /**
   * @generated from enum value: CHANNEL_TYPING_INDICATOR_MODE_HIDDEN = 3;
   */
  HIDDEN = 3,
}

/**
 * Describes the enum fluxer.user.preferences.v1.ChannelTypingIndicatorMode.
 */
export const ChannelTypingIndicatorModeSchema: GenEnum<ChannelTypingIndicatorMode> = /*@__PURE__*/
  enumDesc(file_fluxer_user_preferences_v1_accessibility, 0);

/**
 * @generated from enum fluxer.user.preferences.v1.DmMessagePreviewMode
 */
export enum DmMessagePreviewMode {
  /**
   * @generated from enum value: DM_MESSAGE_PREVIEW_MODE_UNSPECIFIED = 0;
   */
  UNSPECIFIED = 0,

  /**
   * @generated from enum value: DM_MESSAGE_PREVIEW_MODE_ALL = 1;
   */
  ALL = 1,

  /**
   * @generated from enum value: DM_MESSAGE_PREVIEW_MODE_UNREAD_ONLY = 2;
   */
  UNREAD_ONLY = 2,

  /**
   * @generated from enum value: DM_MESSAGE_PREVIEW_MODE_NONE = 3;
   */
  NONE = 3,
}

/**
 * Describes the enum fluxer.user.preferences.v1.DmMessagePreviewMode.
 */
export const DmMessagePreviewModeSchema: GenEnum<DmMessagePreviewMode> = /*@__PURE__*/
  enumDesc(file_fluxer_user_preferences_v1_accessibility, 1);

/**
 * @generated from enum fluxer.user.preferences.v1.HdrDisplayMode
 */
export enum HdrDisplayMode {
  /**
   * @generated from enum value: HDR_DISPLAY_MODE_UNSPECIFIED = 0;
   */
  UNSPECIFIED = 0,

  /**
   * @generated from enum value: HDR_DISPLAY_MODE_FULL = 1;
   */
  FULL = 1,

  /**
   * @generated from enum value: HDR_DISPLAY_MODE_STANDARD = 2;
   */
  STANDARD = 2,
}

/**
 * Describes the enum fluxer.user.preferences.v1.HdrDisplayMode.
 */
export const HdrDisplayModeSchema: GenEnum<HdrDisplayMode> = /*@__PURE__*/
  enumDesc(file_fluxer_user_preferences_v1_accessibility, 2);

import type { GenEnum, GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import { enumDesc, fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";

/**
 * Describes the file fluxer/user/preferences/v1/accessibility.proto.
 */
export const file_fluxer_user_preferences_v1_accessibility: GenFile = /*@__PURE__*/
  fileDesc("Ci5mbHV4ZXIvdXNlci9wcmVmZXJlbmNlcy92MS9hY2Nlc3NpYmlsaXR5LnByb3RvEhpmbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MSKHKAoVQWNjZXNzaWJpbGl0eVNldHRpbmdzEiIKFHNob3dfcGVyc29uYXNfYnV0dG9uGK0RIAEoCEgAiAEBEjEKI3Nob3dfbWVzc2FnZV9hY3Rpb25fYmFyX2NvcHlfYnV0dG9uGK4RIAEoCEgBiAEBEiUKF3Nob3dfYWx0X3RleHRfb25faW1hZ2VzGK8RIAEoCEgCiAEBEh4KEG1vYmlsZV9mb250X3NpemUYsBEgASgBSAOIAQESKgocbW9iaWxlX21lc3NhZ2VfZ3JvdXBfc3BhY2luZxixESABKAFIBIgBARIyCiRtb2JpbGVfY29tcGFjdF9tZXNzYWdlX2dyb3VwX3NwYWNpbmcYshEgASgBSAWIAQESKAoabWVzc2FnZV9kb3VibGVfY2xpY2tfZWRpdHMYsxEgASgISAaIAQESKgocbWVzc2FnZV9kb3VibGVfY2xpY2tfcmVwbGllcxi0ESABKAhIB4gBARIeChFzYXR1cmF0aW9uX2ZhY3RvchgBIAEoAUgIiAEBEh4KFmFsd2F5c191bmRlcmxpbmVfbGlua3MYAiABKAgSIgoVZW5hYmxlX3RleHRfc2VsZWN0aW9uGAMgASgISAmIAQESJQoYc2hvd19tZXNzYWdlX3NlbmRfYnV0dG9uGAQgASgISAqIAQESJQoYc2hvd190ZXh0YXJlYV9mb2N1c19yaW5nGAUgASgISAuIAQESGwoTaGlkZV9rZXlib2FyZF9oaW50cxgGIAEoCBInChplc2NhcGVfZXhpdHNfa2V5Ym9hcmRfbW9kZRgHIAEoCEgMiAEBEiwKH3N5bmNfcmVkdWNlZF9tb3Rpb25fd2l0aF9zeXN0ZW0YCCABKAhIDYgBARIkChdyZWR1Y2VkX21vdGlvbl9vdmVycmlkZRgJIAEoCEgOiAEBEiIKFW1lc3NhZ2VfZ3JvdXBfc3BhY2luZxgKIAEoAUgPiAEBEhsKDm1lc3NhZ2VfZ3V0dGVyGAsgASgBSBCIAQESFgoJZm9udF9zaXplGAwgASgBSBGIAQESLgohc2hvd191c2VyX2F2YXRhcnNfaW5fY29tcGFjdF9tb2RlGA0gASgISBKIAQESKwojbW9iaWxlX3N0aWNrZXJfYW5pbWF0aW9uX292ZXJyaWRkZW4YDiABKAgSJgoebW9iaWxlX2dpZl9hdXRvcGxheV9vdmVycmlkZGVuGA8gASgIEicKH21vYmlsZV9hbmltYXRlX2Vtb2ppX292ZXJyaWRkZW4YECABKAgSKwoebW9iaWxlX3N0aWNrZXJfYW5pbWF0aW9uX3ZhbHVlGBEgASgFSBOIAQESJgoZbW9iaWxlX2dpZl9hdXRvcGxheV92YWx1ZRgSIAEoCEgUiAEBEicKGm1vYmlsZV9hbmltYXRlX2Vtb2ppX3ZhbHVlGBMgASgISBWIAQESIQoUYXV0b19zZW5kX2tsaXB5X2dpZnMYFCABKAhIFogBARIcCg9zaG93X2dpZl9idXR0b24YFSABKAhIF4gBARIeChFzaG93X21lbWVzX2J1dHRvbhgWIAEoCEgYiAEBEiEKFHNob3dfc3RpY2tlcnNfYnV0dG9uGBcgASgISBmIAQESHgoRc2hvd19lbW9qaV9idXR0b24YGCABKAhIGogBARInChpzaG93X21lZGlhX2Zhdm9yaXRlX2J1dHRvbhgZIAEoCEgbiAEBEicKGnNob3dfbWVkaWFfZG93bmxvYWRfYnV0dG9uGBogASgISByIAQESJQoYc2hvd19tZWRpYV9kZWxldGVfYnV0dG9uGBsgASgISB2IAQESKAobc2hvd19zdXBwcmVzc19lbWJlZHNfYnV0dG9uGBwgASgISB6IAQESHwoSc2hvd19naWZfaW5kaWNhdG9yGB0gASgISB+IAQESLQogc2hvd19hdHRhY2htZW50X2V4cGlyeV9pbmRpY2F0b3IYHiABKAhIIIgBARJdCh1jaGFubmVsX3R5cGluZ19pbmRpY2F0b3JfbW9kZRggIAEoDjI2LmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkNoYW5uZWxUeXBpbmdJbmRpY2F0b3JNb2RlEjMKJnNob3dfc2VsZWN0ZWRfY2hhbm5lbF90eXBpbmdfaW5kaWNhdG9yGCEgASgISCGIAQESJAoXc2hvd19tZXNzYWdlX2FjdGlvbl9iYXIYIiABKAhIIogBARI0CidzaG93X21lc3NhZ2VfYWN0aW9uX2Jhcl9xdWlja19yZWFjdGlvbnMYIyABKAhII4gBARIxCiRzaG93X21lc3NhZ2VfYWN0aW9uX2Jhcl9zaGlmdF9leHBhbmQYJCABKAhIJIgBARI1CihzaG93X21lc3NhZ2VfYWN0aW9uX2Jhcl9vbmx5X21vcmVfYnV0dG9uGCUgASgISCWIAQESMAojc2hvd19kZWZhdWx0X2Vtb2ppc19pbl9hdXRvY29tcGxldGUYJiABKAhIJogBARIvCiJzaG93X2N1c3RvbV9lbW9qaXNfaW5fYXV0b2NvbXBsZXRlGCcgASgISCeIAQESKgodc2hvd19zdGlja2Vyc19pbl9hdXRvY29tcGxldGUYKCABKAhIKIgBARInChpzaG93X21lbWVzX2luX2F1dG9jb21wbGV0ZRgpIAEoCEgpiAEBEjUKKHZvaWNlX2NoYW5uZWxfam9pbl9yZXF1aXJlc19kb3VibGVfY2xpY2sYLCABKAhIKogBARIdChBjdXN0b21fdGhlbWVfY3NzGC0gASgJSCuIAQESGwoOc2hvd19mYXZvcml0ZXMYLiABKAhILIgBARIXCgp6b29tX2xldmVsGC8gASgBSC2IAQESUQoXZG1fbWVzc2FnZV9wcmV2aWV3X21vZGUYMCABKA4yMC5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5EbU1lc3NhZ2VQcmV2aWV3TW9kZRIfChJlbmFibGVfdHRzX2NvbW1hbmQYMSABKAhILogBARIVCgh0dHNfcmF0ZRgyIAEoAUgviAEBEjAKI3Nob3dfZmFkZWRfdW5yZWFkX29uX211dGVkX2NoYW5uZWxzGDMgASgISDCIAQESKAobc2hvd19jb250ZXh0X21lbnVfc2hvcnRjdXRzGDQgASgISDGIAQESKgodY29uZmlybV9iZWZvcmVfc3RhcnRpbmdfY2FsbHMYNSABKAhIMogBARJEChBoZHJfZGlzcGxheV9tb2RlGDYgASgOMiouZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuSGRyRGlzcGxheU1vZGUSIAoTcHJlc2VydmVfZWRpdF9kcmFmdBg3IAEoCEgziAEBEiwKH3N0YXlfaW50ZXJhY3RpdmVfd2hlbl91bmZvY3VzZWQYOCABKAhINIgBARIyCiVjb25maXJtX2JlZm9yZV9qb2luaW5nX3ZvaWNlX2NoYW5uZWxzGDkgASgISDWIAQESMAojc2NyZWVuX3JlYWRlcl9hbm5vdW5jZV9uZXdfbWVzc2FnZXMYOiABKAhINogBARI0CidmaXJzdF9jbGlja19wYXNzX3Rocm91Z2hfd2hlbl91bmZvY3VzZWQYOyABKAhIN4gBARIqCh1jb21wYWN0X21lc3NhZ2VfZ3JvdXBfc3BhY2luZxg8IAEoAUg4iAEBEi0KIHNjcm9sbF90b19ib3R0b21fb25fbWVzc2FnZV9zZW5kGD0gASgISDmIAQESIwoWZGltX3N0cmlrZXRocm91Z2hfdGV4dBg+IAEoCEg6iAEBEiEKFHNlcXVlbnRpYWxfZmlsZV9zZW5kGD8gASgISDuIAQESKQocbW9iaWxlX3NwbGFzaF96b29tX2FuaW1hdGlvbhhAIAEoCEg8iAEBEikKHG1lc3NhZ2VfZG91YmxlX2NsaWNrX2FjdGlvbnMYQiABKAhIPYgBARIrCh5hbm5vdW5jZV9jYWxsX2pvaW5zX2FuZF9sZWF2ZXMYQyABKAhIPogBAUIXChVfc2hvd19wZXJzb25hc19idXR0b25CJgokX3Nob3dfbWVzc2FnZV9hY3Rpb25fYmFyX2NvcHlfYnV0dG9uQhoKGF9zaG93X2FsdF90ZXh0X29uX2ltYWdlc0ITChFfbW9iaWxlX2ZvbnRfc2l6ZUIfCh1fbW9iaWxlX21lc3NhZ2VfZ3JvdXBfc3BhY2luZ0InCiVfbW9iaWxlX2NvbXBhY3RfbWVzc2FnZV9ncm91cF9zcGFjaW5nQh0KG19tZXNzYWdlX2RvdWJsZV9jbGlja19lZGl0c0IfCh1fbWVzc2FnZV9kb3VibGVfY2xpY2tfcmVwbGllc0IUChJfc2F0dXJhdGlvbl9mYWN0b3JCGAoWX2VuYWJsZV90ZXh0X3NlbGVjdGlvbkIbChlfc2hvd19tZXNzYWdlX3NlbmRfYnV0dG9uQhsKGV9zaG93X3RleHRhcmVhX2ZvY3VzX3JpbmdCHQobX2VzY2FwZV9leGl0c19rZXlib2FyZF9tb2RlQiIKIF9zeW5jX3JlZHVjZWRfbW90aW9uX3dpdGhfc3lzdGVtQhoKGF9yZWR1Y2VkX21vdGlvbl9vdmVycmlkZUIYChZfbWVzc2FnZV9ncm91cF9zcGFjaW5nQhEKD19tZXNzYWdlX2d1dHRlckIMCgpfZm9udF9zaXplQiQKIl9zaG93X3VzZXJfYXZhdGFyc19pbl9jb21wYWN0X21vZGVCIQofX21vYmlsZV9zdGlja2VyX2FuaW1hdGlvbl92YWx1ZUIcChpfbW9iaWxlX2dpZl9hdXRvcGxheV92YWx1ZUIdChtfbW9iaWxlX2FuaW1hdGVfZW1vamlfdmFsdWVCFwoVX2F1dG9fc2VuZF9rbGlweV9naWZzQhIKEF9zaG93X2dpZl9idXR0b25CFAoSX3Nob3dfbWVtZXNfYnV0dG9uQhcKFV9zaG93X3N0aWNrZXJzX2J1dHRvbkIUChJfc2hvd19lbW9qaV9idXR0b25CHQobX3Nob3dfbWVkaWFfZmF2b3JpdGVfYnV0dG9uQh0KG19zaG93X21lZGlhX2Rvd25sb2FkX2J1dHRvbkIbChlfc2hvd19tZWRpYV9kZWxldGVfYnV0dG9uQh4KHF9zaG93X3N1cHByZXNzX2VtYmVkc19idXR0b25CFQoTX3Nob3dfZ2lmX2luZGljYXRvckIjCiFfc2hvd19hdHRhY2htZW50X2V4cGlyeV9pbmRpY2F0b3JCKQonX3Nob3dfc2VsZWN0ZWRfY2hhbm5lbF90eXBpbmdfaW5kaWNhdG9yQhoKGF9zaG93X21lc3NhZ2VfYWN0aW9uX2JhckIqCihfc2hvd19tZXNzYWdlX2FjdGlvbl9iYXJfcXVpY2tfcmVhY3Rpb25zQicKJV9zaG93X21lc3NhZ2VfYWN0aW9uX2Jhcl9zaGlmdF9leHBhbmRCKwopX3Nob3dfbWVzc2FnZV9hY3Rpb25fYmFyX29ubHlfbW9yZV9idXR0b25CJgokX3Nob3dfZGVmYXVsdF9lbW9qaXNfaW5fYXV0b2NvbXBsZXRlQiUKI19zaG93X2N1c3RvbV9lbW9qaXNfaW5fYXV0b2NvbXBsZXRlQiAKHl9zaG93X3N0aWNrZXJzX2luX2F1dG9jb21wbGV0ZUIdChtfc2hvd19tZW1lc19pbl9hdXRvY29tcGxldGVCKwopX3ZvaWNlX2NoYW5uZWxfam9pbl9yZXF1aXJlc19kb3VibGVfY2xpY2tCEwoRX2N1c3RvbV90aGVtZV9jc3NCEQoPX3Nob3dfZmF2b3JpdGVzQg0KC196b29tX2xldmVsQhUKE19lbmFibGVfdHRzX2NvbW1hbmRCCwoJX3R0c19yYXRlQiYKJF9zaG93X2ZhZGVkX3VucmVhZF9vbl9tdXRlZF9jaGFubmVsc0IeChxfc2hvd19jb250ZXh0X21lbnVfc2hvcnRjdXRzQiAKHl9jb25maXJtX2JlZm9yZV9zdGFydGluZ19jYWxsc0IWChRfcHJlc2VydmVfZWRpdF9kcmFmdEIiCiBfc3RheV9pbnRlcmFjdGl2ZV93aGVuX3VuZm9jdXNlZEIoCiZfY29uZmlybV9iZWZvcmVfam9pbmluZ192b2ljZV9jaGFubmVsc0ImCiRfc2NyZWVuX3JlYWRlcl9hbm5vdW5jZV9uZXdfbWVzc2FnZXNCKgooX2ZpcnN0X2NsaWNrX3Bhc3NfdGhyb3VnaF93aGVuX3VuZm9jdXNlZEIgCh5fY29tcGFjdF9tZXNzYWdlX2dyb3VwX3NwYWNpbmdCIwohX3Njcm9sbF90b19ib3R0b21fb25fbWVzc2FnZV9zZW5kQhkKF19kaW1fc3RyaWtldGhyb3VnaF90ZXh0QhcKFV9zZXF1ZW50aWFsX2ZpbGVfc2VuZEIfCh1fbW9iaWxlX3NwbGFzaF96b29tX2FuaW1hdGlvbkIfCh1fbWVzc2FnZV9kb3VibGVfY2xpY2tfYWN0aW9uc0IhCh9fYW5ub3VuY2VfY2FsbF9qb2luc19hbmRfbGVhdmVzSgQIHxAgSgQIKhArSgQIKxAsSgQIQRBCUiJ1c2VfYnJvd3Nlcl9sb2NhbGVfZm9yX3RpbWVfZm9ybWF0Uh9hdHRhY2htZW50X21lZGlhX2RpbWVuc2lvbl9zaXplUhplbWJlZF9tZWRpYV9kaW1lbnNpb25fc2l6ZVIcZG91YmxlX2NsaWNrX21lc3NhZ2VfYWN0aW9ucyJxChZBY2Nlc3NpYmlsaXR5T3ZlcnJpZGVzEhoKEmdpZl9hdXRvcGxheV9kaXJ0eRgBIAEoCBIbChNhbmltYXRlX2Vtb2ppX2RpcnR5GAIgASgIEh4KFmFuaW1hdGVfc3RpY2tlcnNfZGlydHkYAyABKAgq0gEKGkNoYW5uZWxUeXBpbmdJbmRpY2F0b3JNb2RlEi0KKUNIQU5ORUxfVFlQSU5HX0lORElDQVRPUl9NT0RFX1VOU1BFQ0lGSUVEEAASKQolQ0hBTk5FTF9UWVBJTkdfSU5ESUNBVE9SX01PREVfQVZBVEFSUxABEjAKLENIQU5ORUxfVFlQSU5HX0lORElDQVRPUl9NT0RFX0lORElDQVRPUl9PTkxZEAISKAokQ0hBTk5FTF9UWVBJTkdfSU5ESUNBVE9SX01PREVfSElEREVOEAMqqwEKFERtTWVzc2FnZVByZXZpZXdNb2RlEicKI0RNX01FU1NBR0VfUFJFVklFV19NT0RFX1VOU1BFQ0lGSUVEEAASHwobRE1fTUVTU0FHRV9QUkVWSUVXX01PREVfQUxMEAESJwojRE1fTUVTU0FHRV9QUkVWSUVXX01PREVfVU5SRUFEX09OTFkQAhIgChxETV9NRVNTQUdFX1BSRVZJRVdfTU9ERV9OT05FEAMqbAoOSGRyRGlzcGxheU1vZGUSIAocSERSX0RJU1BMQVlfTU9ERV9VTlNQRUNJRklFRBAAEhkKFUhEUl9ESVNQTEFZX01PREVfRlVMTBABEh0KGUhEUl9ESVNQTEFZX01PREVfU1RBTkRBUkQQAmIGcHJvdG8z");

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
   * Each half of message_double_click_actions on its own: editing your own message, replying to
   * anyone else's. Missing, edits read as on and replies as off (tyne-chat/tyne#611).
   *
   * @generated from field: optional bool message_double_click_edits = 2227;
   */
  messageDoubleClickEdits?: boolean | undefined;

  /**
   * @generated from field: optional bool message_double_click_replies = 2228;
   */
  messageDoubleClickReplies?: boolean | undefined;

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

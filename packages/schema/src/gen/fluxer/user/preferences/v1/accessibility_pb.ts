import type { GenEnum, GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import { enumDesc, fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";

/**
 * Describes the file fluxer/user/preferences/v1/accessibility.proto.
 */
export const file_fluxer_user_preferences_v1_accessibility: GenFile = /*@__PURE__*/
  fileDesc("Ci5mbHV4ZXIvdXNlci9wcmVmZXJlbmNlcy92MS9hY2Nlc3NpYmlsaXR5LnByb3RvEhpmbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MSL2KAoVQWNjZXNzaWJpbGl0eVNldHRpbmdzEiIKFHNob3dfcGVyc29uYXNfYnV0dG9uGK0RIAEoCEgAiAEBEjEKI3Nob3dfbWVzc2FnZV9hY3Rpb25fYmFyX2NvcHlfYnV0dG9uGK4RIAEoCEgBiAEBEiUKF3Nob3dfYWx0X3RleHRfb25faW1hZ2VzGK8RIAEoCEgCiAEBEh4KEG1vYmlsZV9mb250X3NpemUYsBEgASgBSAOIAQESKgocbW9iaWxlX21lc3NhZ2VfZ3JvdXBfc3BhY2luZxixESABKAFIBIgBARIyCiRtb2JpbGVfY29tcGFjdF9tZXNzYWdlX2dyb3VwX3NwYWNpbmcYshEgASgBSAWIAQESKAoabWVzc2FnZV9kb3VibGVfY2xpY2tfZWRpdHMYsxEgASgISAaIAQESKgocbWVzc2FnZV9kb3VibGVfY2xpY2tfcmVwbGllcxi0ESABKAhIB4gBARIfChFzcGFjZV9hZnRlcl9lbW9qaRi1ESABKAhICIgBARIeChFzYXR1cmF0aW9uX2ZhY3RvchgBIAEoAUgJiAEBEh4KFmFsd2F5c191bmRlcmxpbmVfbGlua3MYAiABKAgSIgoVZW5hYmxlX3RleHRfc2VsZWN0aW9uGAMgASgISAqIAQESJQoYc2hvd19tZXNzYWdlX3NlbmRfYnV0dG9uGAQgASgISAuIAQESJQoYc2hvd190ZXh0YXJlYV9mb2N1c19yaW5nGAUgASgISAyIAQESGwoTaGlkZV9rZXlib2FyZF9oaW50cxgGIAEoCBInChplc2NhcGVfZXhpdHNfa2V5Ym9hcmRfbW9kZRgHIAEoCEgNiAEBEiwKH3N5bmNfcmVkdWNlZF9tb3Rpb25fd2l0aF9zeXN0ZW0YCCABKAhIDogBARIkChdyZWR1Y2VkX21vdGlvbl9vdmVycmlkZRgJIAEoCEgPiAEBEiIKFW1lc3NhZ2VfZ3JvdXBfc3BhY2luZxgKIAEoAUgQiAEBEhsKDm1lc3NhZ2VfZ3V0dGVyGAsgASgBSBGIAQESFgoJZm9udF9zaXplGAwgASgBSBKIAQESLgohc2hvd191c2VyX2F2YXRhcnNfaW5fY29tcGFjdF9tb2RlGA0gASgISBOIAQESKwojbW9iaWxlX3N0aWNrZXJfYW5pbWF0aW9uX292ZXJyaWRkZW4YDiABKAgSJgoebW9iaWxlX2dpZl9hdXRvcGxheV9vdmVycmlkZGVuGA8gASgIEicKH21vYmlsZV9hbmltYXRlX2Vtb2ppX292ZXJyaWRkZW4YECABKAgSKwoebW9iaWxlX3N0aWNrZXJfYW5pbWF0aW9uX3ZhbHVlGBEgASgFSBSIAQESJgoZbW9iaWxlX2dpZl9hdXRvcGxheV92YWx1ZRgSIAEoCEgViAEBEicKGm1vYmlsZV9hbmltYXRlX2Vtb2ppX3ZhbHVlGBMgASgISBaIAQESIQoUYXV0b19zZW5kX2tsaXB5X2dpZnMYFCABKAhIF4gBARIcCg9zaG93X2dpZl9idXR0b24YFSABKAhIGIgBARIeChFzaG93X21lbWVzX2J1dHRvbhgWIAEoCEgZiAEBEiEKFHNob3dfc3RpY2tlcnNfYnV0dG9uGBcgASgISBqIAQESHgoRc2hvd19lbW9qaV9idXR0b24YGCABKAhIG4gBARInChpzaG93X21lZGlhX2Zhdm9yaXRlX2J1dHRvbhgZIAEoCEgciAEBEicKGnNob3dfbWVkaWFfZG93bmxvYWRfYnV0dG9uGBogASgISB2IAQESJQoYc2hvd19tZWRpYV9kZWxldGVfYnV0dG9uGBsgASgISB6IAQESKAobc2hvd19zdXBwcmVzc19lbWJlZHNfYnV0dG9uGBwgASgISB+IAQESHwoSc2hvd19naWZfaW5kaWNhdG9yGB0gASgISCCIAQESLQogc2hvd19hdHRhY2htZW50X2V4cGlyeV9pbmRpY2F0b3IYHiABKAhIIYgBARJdCh1jaGFubmVsX3R5cGluZ19pbmRpY2F0b3JfbW9kZRggIAEoDjI2LmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkNoYW5uZWxUeXBpbmdJbmRpY2F0b3JNb2RlEjMKJnNob3dfc2VsZWN0ZWRfY2hhbm5lbF90eXBpbmdfaW5kaWNhdG9yGCEgASgISCKIAQESJAoXc2hvd19tZXNzYWdlX2FjdGlvbl9iYXIYIiABKAhII4gBARI0CidzaG93X21lc3NhZ2VfYWN0aW9uX2Jhcl9xdWlja19yZWFjdGlvbnMYIyABKAhIJIgBARIxCiRzaG93X21lc3NhZ2VfYWN0aW9uX2Jhcl9zaGlmdF9leHBhbmQYJCABKAhIJYgBARI1CihzaG93X21lc3NhZ2VfYWN0aW9uX2Jhcl9vbmx5X21vcmVfYnV0dG9uGCUgASgISCaIAQESMAojc2hvd19kZWZhdWx0X2Vtb2ppc19pbl9hdXRvY29tcGxldGUYJiABKAhIJ4gBARIvCiJzaG93X2N1c3RvbV9lbW9qaXNfaW5fYXV0b2NvbXBsZXRlGCcgASgISCiIAQESKgodc2hvd19zdGlja2Vyc19pbl9hdXRvY29tcGxldGUYKCABKAhIKYgBARInChpzaG93X21lbWVzX2luX2F1dG9jb21wbGV0ZRgpIAEoCEgqiAEBEjUKKHZvaWNlX2NoYW5uZWxfam9pbl9yZXF1aXJlc19kb3VibGVfY2xpY2sYLCABKAhIK4gBARIdChBjdXN0b21fdGhlbWVfY3NzGC0gASgJSCyIAQESGwoOc2hvd19mYXZvcml0ZXMYLiABKAhILYgBARIXCgp6b29tX2xldmVsGC8gASgBSC6IAQESUQoXZG1fbWVzc2FnZV9wcmV2aWV3X21vZGUYMCABKA4yMC5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5EbU1lc3NhZ2VQcmV2aWV3TW9kZRIfChJlbmFibGVfdHRzX2NvbW1hbmQYMSABKAhIL4gBARIVCgh0dHNfcmF0ZRgyIAEoAUgwiAEBEjAKI3Nob3dfZmFkZWRfdW5yZWFkX29uX211dGVkX2NoYW5uZWxzGDMgASgISDGIAQESKAobc2hvd19jb250ZXh0X21lbnVfc2hvcnRjdXRzGDQgASgISDKIAQESKgodY29uZmlybV9iZWZvcmVfc3RhcnRpbmdfY2FsbHMYNSABKAhIM4gBARJEChBoZHJfZGlzcGxheV9tb2RlGDYgASgOMiouZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuSGRyRGlzcGxheU1vZGUSIAoTcHJlc2VydmVfZWRpdF9kcmFmdBg3IAEoCEg0iAEBEiwKH3N0YXlfaW50ZXJhY3RpdmVfd2hlbl91bmZvY3VzZWQYOCABKAhINYgBARIyCiVjb25maXJtX2JlZm9yZV9qb2luaW5nX3ZvaWNlX2NoYW5uZWxzGDkgASgISDaIAQESMAojc2NyZWVuX3JlYWRlcl9hbm5vdW5jZV9uZXdfbWVzc2FnZXMYOiABKAhIN4gBARI0CidmaXJzdF9jbGlja19wYXNzX3Rocm91Z2hfd2hlbl91bmZvY3VzZWQYOyABKAhIOIgBARIqCh1jb21wYWN0X21lc3NhZ2VfZ3JvdXBfc3BhY2luZxg8IAEoAUg5iAEBEi0KIHNjcm9sbF90b19ib3R0b21fb25fbWVzc2FnZV9zZW5kGD0gASgISDqIAQESIwoWZGltX3N0cmlrZXRocm91Z2hfdGV4dBg+IAEoCEg7iAEBEiEKFHNlcXVlbnRpYWxfZmlsZV9zZW5kGD8gASgISDyIAQESKQocbW9iaWxlX3NwbGFzaF96b29tX2FuaW1hdGlvbhhAIAEoCEg9iAEBEikKHG1lc3NhZ2VfZG91YmxlX2NsaWNrX2FjdGlvbnMYQiABKAhIPogBARIrCh5hbm5vdW5jZV9jYWxsX2pvaW5zX2FuZF9sZWF2ZXMYQyABKAhIP4gBARIfChJhbmltYXRlX2dpZl9waWNrZXIYRCABKAhIQIgBAUIXChVfc2hvd19wZXJzb25hc19idXR0b25CJgokX3Nob3dfbWVzc2FnZV9hY3Rpb25fYmFyX2NvcHlfYnV0dG9uQhoKGF9zaG93X2FsdF90ZXh0X29uX2ltYWdlc0ITChFfbW9iaWxlX2ZvbnRfc2l6ZUIfCh1fbW9iaWxlX21lc3NhZ2VfZ3JvdXBfc3BhY2luZ0InCiVfbW9iaWxlX2NvbXBhY3RfbWVzc2FnZV9ncm91cF9zcGFjaW5nQh0KG19tZXNzYWdlX2RvdWJsZV9jbGlja19lZGl0c0IfCh1fbWVzc2FnZV9kb3VibGVfY2xpY2tfcmVwbGllc0IUChJfc3BhY2VfYWZ0ZXJfZW1vamlCFAoSX3NhdHVyYXRpb25fZmFjdG9yQhgKFl9lbmFibGVfdGV4dF9zZWxlY3Rpb25CGwoZX3Nob3dfbWVzc2FnZV9zZW5kX2J1dHRvbkIbChlfc2hvd190ZXh0YXJlYV9mb2N1c19yaW5nQh0KG19lc2NhcGVfZXhpdHNfa2V5Ym9hcmRfbW9kZUIiCiBfc3luY19yZWR1Y2VkX21vdGlvbl93aXRoX3N5c3RlbUIaChhfcmVkdWNlZF9tb3Rpb25fb3ZlcnJpZGVCGAoWX21lc3NhZ2VfZ3JvdXBfc3BhY2luZ0IRCg9fbWVzc2FnZV9ndXR0ZXJCDAoKX2ZvbnRfc2l6ZUIkCiJfc2hvd191c2VyX2F2YXRhcnNfaW5fY29tcGFjdF9tb2RlQiEKH19tb2JpbGVfc3RpY2tlcl9hbmltYXRpb25fdmFsdWVCHAoaX21vYmlsZV9naWZfYXV0b3BsYXlfdmFsdWVCHQobX21vYmlsZV9hbmltYXRlX2Vtb2ppX3ZhbHVlQhcKFV9hdXRvX3NlbmRfa2xpcHlfZ2lmc0ISChBfc2hvd19naWZfYnV0dG9uQhQKEl9zaG93X21lbWVzX2J1dHRvbkIXChVfc2hvd19zdGlja2Vyc19idXR0b25CFAoSX3Nob3dfZW1vamlfYnV0dG9uQh0KG19zaG93X21lZGlhX2Zhdm9yaXRlX2J1dHRvbkIdChtfc2hvd19tZWRpYV9kb3dubG9hZF9idXR0b25CGwoZX3Nob3dfbWVkaWFfZGVsZXRlX2J1dHRvbkIeChxfc2hvd19zdXBwcmVzc19lbWJlZHNfYnV0dG9uQhUKE19zaG93X2dpZl9pbmRpY2F0b3JCIwohX3Nob3dfYXR0YWNobWVudF9leHBpcnlfaW5kaWNhdG9yQikKJ19zaG93X3NlbGVjdGVkX2NoYW5uZWxfdHlwaW5nX2luZGljYXRvckIaChhfc2hvd19tZXNzYWdlX2FjdGlvbl9iYXJCKgooX3Nob3dfbWVzc2FnZV9hY3Rpb25fYmFyX3F1aWNrX3JlYWN0aW9uc0InCiVfc2hvd19tZXNzYWdlX2FjdGlvbl9iYXJfc2hpZnRfZXhwYW5kQisKKV9zaG93X21lc3NhZ2VfYWN0aW9uX2Jhcl9vbmx5X21vcmVfYnV0dG9uQiYKJF9zaG93X2RlZmF1bHRfZW1vamlzX2luX2F1dG9jb21wbGV0ZUIlCiNfc2hvd19jdXN0b21fZW1vamlzX2luX2F1dG9jb21wbGV0ZUIgCh5fc2hvd19zdGlja2Vyc19pbl9hdXRvY29tcGxldGVCHQobX3Nob3dfbWVtZXNfaW5fYXV0b2NvbXBsZXRlQisKKV92b2ljZV9jaGFubmVsX2pvaW5fcmVxdWlyZXNfZG91YmxlX2NsaWNrQhMKEV9jdXN0b21fdGhlbWVfY3NzQhEKD19zaG93X2Zhdm9yaXRlc0INCgtfem9vbV9sZXZlbEIVChNfZW5hYmxlX3R0c19jb21tYW5kQgsKCV90dHNfcmF0ZUImCiRfc2hvd19mYWRlZF91bnJlYWRfb25fbXV0ZWRfY2hhbm5lbHNCHgocX3Nob3dfY29udGV4dF9tZW51X3Nob3J0Y3V0c0IgCh5fY29uZmlybV9iZWZvcmVfc3RhcnRpbmdfY2FsbHNCFgoUX3ByZXNlcnZlX2VkaXRfZHJhZnRCIgogX3N0YXlfaW50ZXJhY3RpdmVfd2hlbl91bmZvY3VzZWRCKAomX2NvbmZpcm1fYmVmb3JlX2pvaW5pbmdfdm9pY2VfY2hhbm5lbHNCJgokX3NjcmVlbl9yZWFkZXJfYW5ub3VuY2VfbmV3X21lc3NhZ2VzQioKKF9maXJzdF9jbGlja19wYXNzX3Rocm91Z2hfd2hlbl91bmZvY3VzZWRCIAoeX2NvbXBhY3RfbWVzc2FnZV9ncm91cF9zcGFjaW5nQiMKIV9zY3JvbGxfdG9fYm90dG9tX29uX21lc3NhZ2Vfc2VuZEIZChdfZGltX3N0cmlrZXRocm91Z2hfdGV4dEIXChVfc2VxdWVudGlhbF9maWxlX3NlbmRCHwodX21vYmlsZV9zcGxhc2hfem9vbV9hbmltYXRpb25CHwodX21lc3NhZ2VfZG91YmxlX2NsaWNrX2FjdGlvbnNCIQofX2Fubm91bmNlX2NhbGxfam9pbnNfYW5kX2xlYXZlc0IVChNfYW5pbWF0ZV9naWZfcGlja2VySgQIHxAgSgQIKhArSgQIKxAsSgQIQRBCUiJ1c2VfYnJvd3Nlcl9sb2NhbGVfZm9yX3RpbWVfZm9ybWF0Uh9hdHRhY2htZW50X21lZGlhX2RpbWVuc2lvbl9zaXplUhplbWJlZF9tZWRpYV9kaW1lbnNpb25fc2l6ZVIcZG91YmxlX2NsaWNrX21lc3NhZ2VfYWN0aW9ucyJxChZBY2Nlc3NpYmlsaXR5T3ZlcnJpZGVzEhoKEmdpZl9hdXRvcGxheV9kaXJ0eRgBIAEoCBIbChNhbmltYXRlX2Vtb2ppX2RpcnR5GAIgASgIEh4KFmFuaW1hdGVfc3RpY2tlcnNfZGlydHkYAyABKAgq0gEKGkNoYW5uZWxUeXBpbmdJbmRpY2F0b3JNb2RlEi0KKUNIQU5ORUxfVFlQSU5HX0lORElDQVRPUl9NT0RFX1VOU1BFQ0lGSUVEEAASKQolQ0hBTk5FTF9UWVBJTkdfSU5ESUNBVE9SX01PREVfQVZBVEFSUxABEjAKLENIQU5ORUxfVFlQSU5HX0lORElDQVRPUl9NT0RFX0lORElDQVRPUl9PTkxZEAISKAokQ0hBTk5FTF9UWVBJTkdfSU5ESUNBVE9SX01PREVfSElEREVOEAMqqwEKFERtTWVzc2FnZVByZXZpZXdNb2RlEicKI0RNX01FU1NBR0VfUFJFVklFV19NT0RFX1VOU1BFQ0lGSUVEEAASHwobRE1fTUVTU0FHRV9QUkVWSUVXX01PREVfQUxMEAESJwojRE1fTUVTU0FHRV9QUkVWSUVXX01PREVfVU5SRUFEX09OTFkQAhIgChxETV9NRVNTQUdFX1BSRVZJRVdfTU9ERV9OT05FEAMqbAoOSGRyRGlzcGxheU1vZGUSIAocSERSX0RJU1BMQVlfTU9ERV9VTlNQRUNJRklFRBAAEhkKFUhEUl9ESVNQTEFZX01PREVfRlVMTBABEh0KGUhEUl9ESVNQTEFZX01PREVfU1RBTkRBUkQQAmIGcHJvdG8z");

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
   * Whether choosing an emoji in the message box adds a space after it. Missing, it reads as on,
   * as before the setting existed (tyne-chat/tyne#650).
   *
   * @generated from field: optional bool space_after_emoji = 2229;
   */
  spaceAfterEmoji?: boolean | undefined;

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

  /**
   * @generated from field: optional bool animate_gif_picker = 68;
   */
  animateGifPicker?: boolean | undefined;
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

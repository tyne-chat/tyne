import type { GenEnum, GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import { enumDesc, fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import type { AccessibilityOverrides, AccessibilitySettings } from "./accessibility_pb";
import { file_fluxer_user_preferences_v1_accessibility } from "./accessibility_pb";
import type { EmojiPickerState, EmojiState, EmojiStickerLayoutSettings, FavoriteGifSettings, MemesPickerState, SoundSettings, StickerPickerState } from "./pickers_pb";
import { file_fluxer_user_preferences_v1_pickers } from "./pickers_pb";
import type { EmojiPinsState } from "./fork_emoji_pins_pb";
import { file_fluxer_user_preferences_v1_fork_emoji_pins } from "./fork_emoji_pins_pb";
import type { Message } from "@bufbuild/protobuf";

/**
 * Describes the file fluxer/user/preferences/v1/preferences.proto.
 */
export const file_fluxer_user_preferences_v1_preferences: GenFile = /*@__PURE__*/
  fileDesc("CixmbHV4ZXIvdXNlci9wcmVmZXJlbmNlcy92MS9wcmVmZXJlbmNlcy5wcm90bxIaZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEizxcKEVN5bmNlZFByZWZlcmVuY2VzEj8KCmVtb2ppX3BpbnMYmBEgASgLMiouZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuRW1vamlQaW5zU3RhdGUSSAoNYWNjZXNzaWJpbGl0eRgBIAEoCzIxLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkFjY2Vzc2liaWxpdHlTZXR0aW5ncxJTChdhY2Nlc3NpYmlsaXR5X292ZXJyaWRlcxgCIAEoCzIyLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkFjY2Vzc2liaWxpdHlPdmVycmlkZXMSSwoPdGV4dHVhbF9wcmV2aWV3GAMgASgLMjIuZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuVGV4dHVhbFByZXZpZXdTZXR0aW5ncxJCCgxlbW9qaV9waWNrZXIYFCABKAsyLC5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5FbW9qaVBpY2tlclN0YXRlEkYKDnN0aWNrZXJfcGlja2VyGBUgASgLMi4uZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuU3RpY2tlclBpY2tlclN0YXRlEkIKDG1lbWVzX3BpY2tlchgWIAEoCzIsLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLk1lbWVzUGlja2VyU3RhdGUSNQoFZW1vamkYFyABKAsyJi5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5FbW9qaVN0YXRlElQKFGVtb2ppX3N0aWNrZXJfbGF5b3V0GBggASgLMjYuZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuRW1vamlTdGlja2VyTGF5b3V0U2V0dGluZ3MSRgoNZmF2b3JpdGVfZ2lmcxgZIAEoCzIvLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkZhdm9yaXRlR2lmU2V0dGluZ3MSPQoJZmF2b3JpdGVzGCggASgLMiouZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuRmF2b3JpdGVzU3RhdGUSSwoPcmVjZW50X21lbnRpb25zGCkgASgLMjIuZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuUmVjZW50TWVudGlvbnNTZXR0aW5ncxI/CgdzaWRlYmFyGCogASgLMi4uZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuU2lkZWJhclByZWZlcmVuY2VzEkAKC21lbWJlcl9saXN0GCsgASgLMisuZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuTWVtYmVyTGlzdFN0YXRlEkgKD3VucmVhZF9jaGFubmVscxgsIAEoCzIvLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLlVucmVhZENoYW5uZWxzU3RhdGUSSgoQbWVudGlvbl9mcmVjZW5jeRgtIAEoCzIwLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLk1lbnRpb25GcmVjZW5jeVN0YXRlEj0KB25hZ2JhcnMYPCABKAsyLC5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5OYWdiYXJEaXNtaXNzYWxzEkcKEWRpc21pc3NlZF91cHNlbGxzGD0gASgLMiwuZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuRGlzbWlzc2VkVXBzZWxscxJOChVndWlsZF9uc2Z3X2FncmVlbWVudHMYPiABKAsyLy5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5HdWlsZE5zZndBZ3JlZW1lbnRzEjwKCXdoYXRzX25ldxg/IAEoCzIpLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLldoYXRzTmV3U3RhdGUSPwoHcHJpdmFjeRhQIAEoCzIuLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLlByaXZhY3lQcmVmZXJlbmNlcxJQChRsb2NhbF9zcGFtX292ZXJyaWRlcxhRIAEoCzIyLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkxvY2FsVXNlclNwYW1PdmVycmlkZXMSFQoNc2FuaXRpemVfdXJscxhSIAEoCBI4CgVzb3VuZBhkIAEoCzIpLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLlNvdW5kU2V0dGluZ3MSQgoKc3BlbGxjaGVjaxhlIAEoCzIuLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLlNwZWxsY2hlY2tTZXR0aW5ncxJICg5zZWFyY2hfZW5naW5lcxhmIAEoCzIwLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLlNlYXJjaEVuZ2luZVNldHRpbmdzEk8KEXBlcm1pc3Npb25fbGF5b3V0GGcgASgLMjQuZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuUGVybWlzc2lvbkxheW91dFNldHRpbmdzElIKE2d1aWxkX21lbWJlcl9sYXlvdXQYaCABKAsyNS5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5HdWlsZE1lbWJlckxheW91dFNldHRpbmdzEksKDWd1aWxkX2ZvbGRlcnMYaSABKAsyNC5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5HdWlsZEZvbGRlckV4cGFuZGVkU3RhdGUSUAoUaGlkZGVuX2d1aWxkX2J1dHRvbnMYaiABKAsyMi5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5IaWRkZW5HdWlsZExpc3RCdXR0b25zEk8KE2tleWJvYXJkX21vZGVfaW50cm8YayABKAsyMi5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5LZXlib2FyZE1vZGVJbnRyb1N0YXRlElEKEGlucHV0X21vbml0b3JpbmcYbCABKAsyNy5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5JbnB1dE1vbml0b3JpbmdQcm9tcHRzU3RhdGUSRAoNdm9pY2VfcHJvbXB0cxhtIAEoCzItLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLlZvaWNlUHJvbXB0c1N0YXRlEkAKC3N1ZG9fcHJvbXB0GG4gASgLMisuZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuU3Vkb1Byb21wdFN0YXRlEj0KCGtleWJpbmRzGG8gASgLMisuZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuS2V5YmluZFNldHRpbmdzEkEKCmNoYXRfaW5wdXQYcCABKAsyLS5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5DaGF0SW5wdXRTZXR0aW5ncxIqCh1zYXZlX2NhbWVyYV91cGxvYWRzX3RvX2RldmljZRhxIAEoCEgAiAEBEkYKE2RvdWJsZV90YXBfcmVhY3Rpb24YciABKAsyKS5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5SZWFjdGlvbkVtb2ppEkoKEGNoYW5uZWxfZnJlY2VuY3kYcyABKAsyMC5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5DaGFubmVsRnJlY2VuY3lTdGF0ZRJSChRhbm5vdW5jZW1lbnRfcHJvbXB0cxh0IAEoCzI0LmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkFubm91bmNlbWVudFByb21wdHNTdGF0ZRJGChFkb3VibGVfdGFwX2FjdGlvbhh1IAEoDjIrLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkRvdWJsZVRhcEFjdGlvbhJLChpzd2lwZV9yaWdodF90b19sZWZ0X2FjdGlvbhh2IAEoDjInLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLlN3aXBlQWN0aW9uQiAKHl9zYXZlX2NhbWVyYV91cGxvYWRzX3RvX2RldmljZSKwAQoSU3BlbGxjaGVja1NldHRpbmdzEhQKB2VuYWJsZWQYASABKAhIAIgBARIRCglsYW5ndWFnZXMYAiADKAkSGwoTcGVyc29uYWxfZGljdGlvbmFyeRgDIAMoCRIYCgthdXRvX2RldGVjdBgEIAEoCEgBiAEBEhMKBmVuZ2luZRgFIAEoCUgCiAEBQgoKCF9lbmFibGVkQg4KDF9hdXRvX2RldGVjdEIJCgdfZW5naW5lIuYBChRTZWFyY2hFbmdpbmVTZXR0aW5ncxIiChV0ZXh0X3NlYXJjaF9lbmdpbmVfaWQYASABKAlIAIgBARIrCh5yZXZlcnNlX2ltYWdlX3NlYXJjaF9lbmdpbmVfaWQYAiABKAlIAYgBARIkChd0cmFuc2xhdGlvbl9wcm92aWRlcl9pZBgDIAEoCUgCiAEBQhgKFl90ZXh0X3NlYXJjaF9lbmdpbmVfaWRCIQofX3JldmVyc2VfaW1hZ2Vfc2VhcmNoX2VuZ2luZV9pZEIaChhfdHJhbnNsYXRpb25fcHJvdmlkZXJfaWQitQEKElByaXZhY3lQcmVmZXJlbmNlcxIfChdkaXNhYmxlX3N0cmVhbV9wcmV2aWV3cxgBIAEoCBIcCg9zaG93X2FjdGl2ZV9ub3cYAiABKAhIAIgBARIqCh1wcmV1cGxvYWRfbWVzc2FnZV9hdHRhY2htZW50cxgDIAEoCEgBiAEBQhIKEF9zaG93X2FjdGl2ZV9ub3dCIAoeX3ByZXVwbG9hZF9tZXNzYWdlX2F0dGFjaG1lbnRzIlAKFkxvY2FsVXNlclNwYW1PdmVycmlkZXMSGAoQc3BhbW1lcl91c2VyX2lkcxgBIAMoCRIcChRub3Rfc3BhbW1lcl91c2VyX2lkcxgCIAMoCSIrChZUZXh0dWFsUHJldmlld1NldHRpbmdzEhEKCXdyYXBfdGV4dBgBIAEoCCLcAQoSU2lkZWJhclByZWZlcmVuY2VzEhwKFGlubGluZV9kbXNfY29sbGFwc2VkGAEgASgIEiwKH3Nob3dfY29sbGFwc2VkX3VucmVhZF9kbXNfYmFkZ2UYAiABKAhIAIgBARIvCiJzaG93X2luY29taW5nX2ZyaWVuZF9yZXF1ZXN0X2JhZGdlGAMgASgISAGIAQFCIgogX3Nob3dfY29sbGFwc2VkX3VucmVhZF9kbXNfYmFkZ2VCJQojX3Nob3dfaW5jb21pbmdfZnJpZW5kX3JlcXVlc3RfYmFkZ2UiPQoPTWVtYmVyTGlzdFN0YXRlEhkKDG1lbWJlcnNfb3BlbhgBIAEoCEgAiAEBQg8KDV9tZW1iZXJzX29wZW4iNAoTVW5yZWFkQ2hhbm5lbHNTdGF0ZRIdChVjb2xsYXBzZWRfY2hhbm5lbF9pZHMYASADKAkiqgEKFlJlY2VudE1lbnRpb25zU2V0dGluZ3MSHQoQaW5jbHVkZV9ldmVyeW9uZRgBIAEoCEgAiAEBEhoKDWluY2x1ZGVfcm9sZXMYAiABKAhIAYgBARIbCg5pbmNsdWRlX2d1aWxkcxgDIAEoCEgCiAEBQhMKEV9pbmNsdWRlX2V2ZXJ5b25lQhAKDl9pbmNsdWRlX3JvbGVzQhEKD19pbmNsdWRlX2d1aWxkcyL/AQoUTWVudGlvbkZyZWNlbmN5U3RhdGUSRgoGc2NvcGVzGAEgAygLMjYuZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuTWVudGlvbkZyZWNlbmN5U3RhdGUuU2NvcGUaOwoFRW50cnkSDwoHdXNlcl9pZBgBIAEoCRINCgVjb3VudBgCIAEoDRISCgpsYXN0X2F0X21zGAMgASgDGmIKBVNjb3BlEhAKCGd1aWxkX2lkGAEgASgJEkcKB2VudHJpZXMYAiADKAsyNi5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5NZW50aW9uRnJlY2VuY3lTdGF0ZS5FbnRyeSLdAQoORmF2b3JpdGVzU3RhdGUSPQoIY2hhbm5lbHMYASADKAsyKy5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5GYXZvcml0ZUNoYW5uZWwSQAoKY2F0ZWdvcmllcxgCIAMoCzIsLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkZhdm9yaXRlQ2F0ZWdvcnkSHgoWY29sbGFwc2VkX2NhdGVnb3J5X2lkcxgDIAMoCRIbChNoaWRlX211dGVkX2NoYW5uZWxzGAQgASgIEg0KBW11dGVkGAUgASgIIpMBCg9GYXZvcml0ZUNoYW5uZWwSEgoKY2hhbm5lbF9pZBgBIAEoCRIQCghndWlsZF9pZBgCIAEoCRIWCglwYXJlbnRfaWQYAyABKAlIAIgBARIQCghwb3NpdGlvbhgEIAEoBRIVCghuaWNrbmFtZRgFIAEoCUgBiAEBQgwKCl9wYXJlbnRfaWRCCwoJX25pY2tuYW1lIj4KEEZhdm9yaXRlQ2F0ZWdvcnkSCgoCaWQYASABKAkSDAoEbmFtZRgCIAEoCRIQCghwb3NpdGlvbhgDIAEoBSLjCAoQTmFnYmFyRGlzbWlzc2FscxITCgtpb3NfaW5zdGFsbBgBIAEoCBITCgtwd2FfaW5zdGFsbBgCIAEoCBIZChFwdXNoX25vdGlmaWNhdGlvbhgDIAEoCBIcChRkZXNrdG9wX25vdGlmaWNhdGlvbhgEIAEoCBIcChRwcmVtaXVtX2dyYWNlX3BlcmlvZBgFIAEoCBIXCg9wcmVtaXVtX2V4cGlyZWQYBiABKAgSGgoScHJlbWl1bV9vbmJvYXJkaW5nGAcgASgIEh4KFnByZW1pdW1fdHJpYWxfZXhwaXJpbmcYCCABKAgSFgoOZ2lmdF9pbnZlbnRvcnkYCSABKAgSGAoQZGVza3RvcF9kb3dubG9hZBgKIAEoCBIcChRndWlsZF9tZW1iZXJzaGlwX2N0YRgLIAEoCBIVCg12aXNpb25hcnlfbWZhGAwgASgIEmQKFXBlbmRpbmdfYnVsa19kZWxldGlvbhgPIAMoCzJFLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLk5hZ2JhckRpc21pc3NhbHMuUGVuZGluZ0J1bGtEZWxldGlvbkVudHJ5ElsKEGludml0ZXNfZGlzYWJsZWQYECADKAsyQS5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5OYWdiYXJEaXNtaXNzYWxzLkludml0ZXNEaXNhYmxlZEVudHJ5EmQKFWd1aWxkX21mYV9yZXF1aXJlbWVudBgRIAMoCzJFLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLk5hZ2JhckRpc21pc3NhbHMuR3VpbGRNZmFSZXF1aXJlbWVudEVudHJ5El8KEnByaWNlX2Fubm91bmNlbWVudBgSIAMoCzJDLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLk5hZ2JhckRpc21pc3NhbHMuUHJpY2VBbm5vdW5jZW1lbnRFbnRyeRJfChNsZWdhY3lfcHJpY2Vfb3B0X2luGBMgAygLMkIuZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuTmFnYmFyRGlzbWlzc2Fscy5MZWdhY3lQcmljZU9wdEluRW50cnkaOgoYUGVuZGluZ0J1bGtEZWxldGlvbkVudHJ5EgsKA2tleRgBIAEoCRINCgV2YWx1ZRgCIAEoCDoCOAEaNgoUSW52aXRlc0Rpc2FibGVkRW50cnkSCwoDa2V5GAEgASgJEg0KBXZhbHVlGAIgASgIOgI4ARo6ChhHdWlsZE1mYVJlcXVpcmVtZW50RW50cnkSCwoDa2V5GAEgASgJEg0KBXZhbHVlGAIgASgIOgI4ARo4ChZQcmljZUFubm91bmNlbWVudEVudHJ5EgsKA2tleRgBIAEoCRINCgV2YWx1ZRgCIAEoCDoCOAEaNwoVTGVnYWN5UHJpY2VPcHRJbkVudHJ5EgsKA2tleRgBIAEoCRINCgV2YWx1ZRgCIAEoCDoCOAFKBAgOEA8iKgoQRGlzbWlzc2VkVXBzZWxscxIWCg5waWNrZXJfcHJlbWl1bRgBIAEoCCJoChNHdWlsZE5zZndBZ3JlZW1lbnRzEhoKEmFncmVlZF9jaGFubmVsX2lkcxgBIAMoCRIYChBhZ3JlZWRfZ3VpbGRfaWRzGAIgAygJEhsKE2FncmVlZF9jYXRlZ29yeV9pZHMYAyADKAkiUQoNV2hhdHNOZXdTdGF0ZRIkChdsYXN0X2Rpc21pc3NlZF9lbnRyeV9pZBgBIAEoCUgAiAEBQhoKGF9sYXN0X2Rpc21pc3NlZF9lbnRyeV9pZCKaAQoYUGVybWlzc2lvbkxheW91dFNldHRpbmdzEkAKBmxheW91dBgBIAEoDjIwLmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLlBlcm1pc3Npb25MYXlvdXRNb2RlEjwKBGdyaWQYAiABKA4yLi5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5QZXJtaXNzaW9uR3JpZE1vZGUiWgoZR3VpbGRNZW1iZXJMYXlvdXRTZXR0aW5ncxI9CgRtb2RlGAEgASgOMi8uZmx1eGVyLnVzZXIucHJlZmVyZW5jZXMudjEuR3VpbGRNZW1iZXJWaWV3TW9kZSI3ChhHdWlsZEZvbGRlckV4cGFuZGVkU3RhdGUSGwoTZXhwYW5kZWRfZm9sZGVyX2lkcxgBIAMoBiJGChZIaWRkZW5HdWlsZExpc3RCdXR0b25zEhcKD2Rvd25sb2FkX2J1dHRvbhgBIAEoCBITCgtoZWxwX2J1dHRvbhgCIAEoCCImChZLZXlib2FyZE1vZGVJbnRyb1N0YXRlEgwKBHNlZW4YASABKAgiLwobSW5wdXRNb25pdG9yaW5nUHJvbXB0c1N0YXRlEhAKCHNlZW5fY3RhGAEgASgIIoMBChFWb2ljZVByb21wdHNTdGF0ZRIkChxza2lwX2hpZGVfb3duX2NhbWVyYV9jb25maXJtGAEgASgIEikKIXNraXBfaGlkZV9vd25fc2NyZWVuc2hhcmVfY29uZmlybRgCIAEoCBIdChVza2lwX3AycF9qb2luX2NvbmZpcm0YAyABKAgiNgoYQW5ub3VuY2VtZW50UHJvbXB0c1N0YXRlEhoKEmhpZGVfcHVibGlzaF9udWRnZRgBIAEoCCJ0Cg9TdWRvUHJvbXB0U3RhdGUSSAoUbGFzdF91c2VkX21mYV9tZXRob2QYASABKA4yJS5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5NZmFNZXRob2RIAIgBAUIXChVfbGFzdF91c2VkX21mYV9tZXRob2QiugEKD0tleWJpbmRTZXR0aW5ncxJCCg9jdXN0b21fa2V5YmluZHMYASADKAsyKS5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5DdXN0b21LZXliaW5kEhUKDXRyYW5zbWl0X21vZGUYAiABKAkSKgodcHVzaF90b190YWxrX3JlbGVhc2VfZGVsYXlfbXMYAyABKA1IAIgBAUIgCh5fcHVzaF90b190YWxrX3JlbGVhc2VfZGVsYXlfbXMihQEKDUN1c3RvbUtleWJpbmQSCgoCaWQYASABKAkSEwoGYWN0aW9uGAIgASgJSACIAQESNwoFY29tYm8YAyABKAsyKC5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5LZXliaW5kQ29tYm8SDwoHZW5hYmxlZBgEIAEoCEIJCgdfYWN0aW9uIs4CCgxLZXliaW5kQ29tYm8SCwoDa2V5GAEgASgJEhEKBGNvZGUYAiABKAlIAIgBARIUCgxjdHJsX29yX21ldGEYAyABKAgSDAoEY3RybBgEIAEoCBILCgNhbHQYBSABKAgSDQoFc2hpZnQYBiABKAgSDAoEbWV0YRgHIAEoCBITCgZnbG9iYWwYCCABKAhIAYgBARIUCgdlbmFibGVkGAkgASgISAKIAQESFQoNbW9kaWZpZXJfb25seRgKIAEoCBISCgpib3RoX3NpZGVzGAsgASgIEhkKDG1vdXNlX2J1dHRvbhgMIAEoDUgDiAEBEhsKDmdhbWVwYWRfYnV0dG9uGA0gASgNSASIAQFCBwoFX2NvZGVCCQoHX2dsb2JhbEIKCghfZW5hYmxlZEIPCg1fbW91c2VfYnV0dG9uQhEKD19nYW1lcGFkX2J1dHRvbiJCChRDaGFubmVsRnJlY2VuY3lFbnRyeRISCgp0b3RhbF91c2VzGAEgASgNEhYKDnJlY2VudF91c2VzX21zGAIgAygDIsIBChRDaGFubmVsRnJlY2VuY3lTdGF0ZRJKCgV1c2FnZRgBIAMoCzI7LmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkNoYW5uZWxGcmVjZW5jeVN0YXRlLlVzYWdlRW50cnkaXgoKVXNhZ2VFbnRyeRILCgNrZXkYASABKAkSPwoFdmFsdWUYAiABKAsyMC5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5DaGFubmVsRnJlY2VuY3lFbnRyeToCOAEiSQoRQ2hhdElucHV0U2V0dGluZ3MSHgoRY29udmVydF9lbW90aWNvbnMYASABKAhIAIgBAUIUChJfY29udmVydF9lbW90aWNvbnMiNQoNUmVhY3Rpb25FbW9qaRIPCgJpZBgBIAEoCUgAiAEBEgwKBG5hbWUYAiABKAlCBQoDX2lkKoIBChRQZXJtaXNzaW9uTGF5b3V0TW9kZRImCiJQRVJNSVNTSU9OX0xBWU9VVF9NT0RFX1VOU1BFQ0lGSUVEEAASIAocUEVSTUlTU0lPTl9MQVlPVVRfTU9ERV9DT01GWRABEiAKHFBFUk1JU1NJT05fTEFZT1VUX01PREVfREVOU0UQAip6ChJQZXJtaXNzaW9uR3JpZE1vZGUSJAogUEVSTUlTU0lPTl9HUklEX01PREVfVU5TUEVDSUZJRUQQABIfChtQRVJNSVNTSU9OX0dSSURfTU9ERV9TSU5HTEUQARIdChlQRVJNSVNTSU9OX0dSSURfTU9ERV9HUklEEAIqgAEKE0d1aWxkTWVtYmVyVmlld01vZGUSJgoiR1VJTERfTUVNQkVSX1ZJRVdfTU9ERV9VTlNQRUNJRklFRBAAEiAKHEdVSUxEX01FTUJFUl9WSUVXX01PREVfVEFCTEUQARIfChtHVUlMRF9NRU1CRVJfVklFV19NT0RFX0dSSUQQAipVCglNZmFNZXRob2QSGgoWTUZBX01FVEhPRF9VTlNQRUNJRklFRBAAEhMKD01GQV9NRVRIT0RfVE9UUBABEhcKE01GQV9NRVRIT0RfV0VCQVVUSE4QAyqJAQoPRG91YmxlVGFwQWN0aW9uEiEKHURPVUJMRV9UQVBfQUNUSU9OX1VOU1BFQ0lGSUVEEAASGwoXRE9VQkxFX1RBUF9BQ1RJT05fUkVBQ1QQARIaChZET1VCTEVfVEFQX0FDVElPTl9FRElUEAISGgoWRE9VQkxFX1RBUF9BQ1RJT05fTk9ORRADKmUKC1N3aXBlQWN0aW9uEhwKGFNXSVBFX0FDVElPTl9VTlNQRUNJRklFRBAAEiAKHFNXSVBFX0FDVElPTl9DSEFOTkVMX0RFVEFJTFMQARIWChJTV0lQRV9BQ1RJT05fUkVQTFkQAmIGcHJvdG8z", [file_fluxer_user_preferences_v1_accessibility, file_fluxer_user_preferences_v1_pickers, file_fluxer_user_preferences_v1_fork_emoji_pins]);

/**
 * @generated from message fluxer.user.preferences.v1.SyncedPreferences
 */
export type SyncedPreferences = Message<"fluxer.user.preferences.v1.SyncedPreferences"> & {
  /**
   * Fork fields. The fork numbers its own fields from 2200 up, in this block; never give a
   * fork field the next number after upstream's last one (`accessibility.proto` says why), and
   * never one of 120 to 125, which the fork once used (`RetiredSyncedPreferenceFields.ts`).
   *
   * @generated from field: fluxer.user.preferences.v1.EmojiPinsState emoji_pins = 2200;
   */
  emojiPins?: EmojiPinsState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.AccessibilitySettings accessibility = 1;
   */
  accessibility?: AccessibilitySettings | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.AccessibilityOverrides accessibility_overrides = 2;
   */
  accessibilityOverrides?: AccessibilityOverrides | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.TextualPreviewSettings textual_preview = 3;
   */
  textualPreview?: TextualPreviewSettings | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.EmojiPickerState emoji_picker = 20;
   */
  emojiPicker?: EmojiPickerState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.StickerPickerState sticker_picker = 21;
   */
  stickerPicker?: StickerPickerState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.MemesPickerState memes_picker = 22;
   */
  memesPicker?: MemesPickerState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.EmojiState emoji = 23;
   */
  emoji?: EmojiState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.EmojiStickerLayoutSettings emoji_sticker_layout = 24;
   */
  emojiStickerLayout?: EmojiStickerLayoutSettings | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.FavoriteGifSettings favorite_gifs = 25;
   */
  favoriteGifs?: FavoriteGifSettings | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.FavoritesState favorites = 40;
   */
  favorites?: FavoritesState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.RecentMentionsSettings recent_mentions = 41;
   */
  recentMentions?: RecentMentionsSettings | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.SidebarPreferences sidebar = 42;
   */
  sidebar?: SidebarPreferences | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.MemberListState member_list = 43;
   */
  memberList?: MemberListState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.UnreadChannelsState unread_channels = 44;
   */
  unreadChannels?: UnreadChannelsState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.MentionFrecencyState mention_frecency = 45;
   */
  mentionFrecency?: MentionFrecencyState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.NagbarDismissals nagbars = 60;
   */
  nagbars?: NagbarDismissals | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.DismissedUpsells dismissed_upsells = 61;
   */
  dismissedUpsells?: DismissedUpsells | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.GuildNsfwAgreements guild_nsfw_agreements = 62;
   */
  guildNsfwAgreements?: GuildNsfwAgreements | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.WhatsNewState whats_new = 63;
   */
  whatsNew?: WhatsNewState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.PrivacyPreferences privacy = 80;
   */
  privacy?: PrivacyPreferences | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.LocalUserSpamOverrides local_spam_overrides = 81;
   */
  localSpamOverrides?: LocalUserSpamOverrides | undefined;

  /**
   * @generated from field: bool sanitize_urls = 82;
   */
  sanitizeUrls: boolean;

  /**
   * @generated from field: fluxer.user.preferences.v1.SoundSettings sound = 100;
   */
  sound?: SoundSettings | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.SpellcheckSettings spellcheck = 101;
   */
  spellcheck?: SpellcheckSettings | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.SearchEngineSettings search_engines = 102;
   */
  searchEngines?: SearchEngineSettings | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.PermissionLayoutSettings permission_layout = 103;
   */
  permissionLayout?: PermissionLayoutSettings | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.GuildMemberLayoutSettings guild_member_layout = 104;
   */
  guildMemberLayout?: GuildMemberLayoutSettings | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.GuildFolderExpandedState guild_folders = 105;
   */
  guildFolders?: GuildFolderExpandedState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.HiddenGuildListButtons hidden_guild_buttons = 106;
   */
  hiddenGuildButtons?: HiddenGuildListButtons | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.KeyboardModeIntroState keyboard_mode_intro = 107;
   */
  keyboardModeIntro?: KeyboardModeIntroState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.InputMonitoringPromptsState input_monitoring = 108;
   */
  inputMonitoring?: InputMonitoringPromptsState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.VoicePromptsState voice_prompts = 109;
   */
  voicePrompts?: VoicePromptsState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.SudoPromptState sudo_prompt = 110;
   */
  sudoPrompt?: SudoPromptState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.KeybindSettings keybinds = 111;
   */
  keybinds?: KeybindSettings | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.ChatInputSettings chat_input = 112;
   */
  chatInput?: ChatInputSettings | undefined;

  /**
   * @generated from field: optional bool save_camera_uploads_to_device = 113;
   */
  saveCameraUploadsToDevice?: boolean | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.ReactionEmoji double_tap_reaction = 114;
   */
  doubleTapReaction?: ReactionEmoji | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.ChannelFrecencyState channel_frecency = 115;
   */
  channelFrecency?: ChannelFrecencyState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.AnnouncementPromptsState announcement_prompts = 116;
   */
  announcementPrompts?: AnnouncementPromptsState | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.DoubleTapAction double_tap_action = 117;
   */
  doubleTapAction: DoubleTapAction;

  /**
   * @generated from field: fluxer.user.preferences.v1.SwipeAction swipe_right_to_left_action = 118;
   */
  swipeRightToLeftAction: SwipeAction;
};

/**
 * Describes the message fluxer.user.preferences.v1.SyncedPreferences.
 * Use `create(SyncedPreferencesSchema)` to create a new message.
 */
export const SyncedPreferencesSchema: GenMessage<SyncedPreferences> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 0);

/**
 * @generated from message fluxer.user.preferences.v1.SpellcheckSettings
 */
export type SpellcheckSettings = Message<"fluxer.user.preferences.v1.SpellcheckSettings"> & {
  /**
   * @generated from field: optional bool enabled = 1;
   */
  enabled?: boolean | undefined;

  /**
   * @generated from field: repeated string languages = 2;
   */
  languages: string[];

  /**
   * @generated from field: repeated string personal_dictionary = 3;
   */
  personalDictionary: string[];

  /**
   * @generated from field: optional bool auto_detect = 4;
   */
  autoDetect?: boolean | undefined;

  /**
   * @generated from field: optional string engine = 5;
   */
  engine?: string | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.SpellcheckSettings.
 * Use `create(SpellcheckSettingsSchema)` to create a new message.
 */
export const SpellcheckSettingsSchema: GenMessage<SpellcheckSettings> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 1);

/**
 * @generated from message fluxer.user.preferences.v1.SearchEngineSettings
 */
export type SearchEngineSettings = Message<"fluxer.user.preferences.v1.SearchEngineSettings"> & {
  /**
   * @generated from field: optional string text_search_engine_id = 1;
   */
  textSearchEngineId?: string | undefined;

  /**
   * @generated from field: optional string reverse_image_search_engine_id = 2;
   */
  reverseImageSearchEngineId?: string | undefined;

  /**
   * @generated from field: optional string translation_provider_id = 3;
   */
  translationProviderId?: string | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.SearchEngineSettings.
 * Use `create(SearchEngineSettingsSchema)` to create a new message.
 */
export const SearchEngineSettingsSchema: GenMessage<SearchEngineSettings> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 2);

/**
 * @generated from message fluxer.user.preferences.v1.PrivacyPreferences
 */
export type PrivacyPreferences = Message<"fluxer.user.preferences.v1.PrivacyPreferences"> & {
  /**
   * @generated from field: bool disable_stream_previews = 1;
   */
  disableStreamPreviews: boolean;

  /**
   * @generated from field: optional bool show_active_now = 2;
   */
  showActiveNow?: boolean | undefined;

  /**
   * @generated from field: optional bool preupload_message_attachments = 3;
   */
  preuploadMessageAttachments?: boolean | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.PrivacyPreferences.
 * Use `create(PrivacyPreferencesSchema)` to create a new message.
 */
export const PrivacyPreferencesSchema: GenMessage<PrivacyPreferences> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 3);

/**
 * @generated from message fluxer.user.preferences.v1.LocalUserSpamOverrides
 */
export type LocalUserSpamOverrides = Message<"fluxer.user.preferences.v1.LocalUserSpamOverrides"> & {
  /**
   * @generated from field: repeated string spammer_user_ids = 1;
   */
  spammerUserIds: string[];

  /**
   * @generated from field: repeated string not_spammer_user_ids = 2;
   */
  notSpammerUserIds: string[];
};

/**
 * Describes the message fluxer.user.preferences.v1.LocalUserSpamOverrides.
 * Use `create(LocalUserSpamOverridesSchema)` to create a new message.
 */
export const LocalUserSpamOverridesSchema: GenMessage<LocalUserSpamOverrides> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 4);

/**
 * @generated from message fluxer.user.preferences.v1.TextualPreviewSettings
 */
export type TextualPreviewSettings = Message<"fluxer.user.preferences.v1.TextualPreviewSettings"> & {
  /**
   * @generated from field: bool wrap_text = 1;
   */
  wrapText: boolean;
};

/**
 * Describes the message fluxer.user.preferences.v1.TextualPreviewSettings.
 * Use `create(TextualPreviewSettingsSchema)` to create a new message.
 */
export const TextualPreviewSettingsSchema: GenMessage<TextualPreviewSettings> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 5);

/**
 * @generated from message fluxer.user.preferences.v1.SidebarPreferences
 */
export type SidebarPreferences = Message<"fluxer.user.preferences.v1.SidebarPreferences"> & {
  /**
   * @generated from field: bool inline_dms_collapsed = 1;
   */
  inlineDmsCollapsed: boolean;

  /**
   * @generated from field: optional bool show_collapsed_unread_dms_badge = 2;
   */
  showCollapsedUnreadDmsBadge?: boolean | undefined;

  /**
   * @generated from field: optional bool show_incoming_friend_request_badge = 3;
   */
  showIncomingFriendRequestBadge?: boolean | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.SidebarPreferences.
 * Use `create(SidebarPreferencesSchema)` to create a new message.
 */
export const SidebarPreferencesSchema: GenMessage<SidebarPreferences> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 6);

/**
 * @generated from message fluxer.user.preferences.v1.MemberListState
 */
export type MemberListState = Message<"fluxer.user.preferences.v1.MemberListState"> & {
  /**
   * @generated from field: optional bool members_open = 1;
   */
  membersOpen?: boolean | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.MemberListState.
 * Use `create(MemberListStateSchema)` to create a new message.
 */
export const MemberListStateSchema: GenMessage<MemberListState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 7);

/**
 * @generated from message fluxer.user.preferences.v1.UnreadChannelsState
 */
export type UnreadChannelsState = Message<"fluxer.user.preferences.v1.UnreadChannelsState"> & {
  /**
   * @generated from field: repeated string collapsed_channel_ids = 1;
   */
  collapsedChannelIds: string[];
};

/**
 * Describes the message fluxer.user.preferences.v1.UnreadChannelsState.
 * Use `create(UnreadChannelsStateSchema)` to create a new message.
 */
export const UnreadChannelsStateSchema: GenMessage<UnreadChannelsState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 8);

/**
 * @generated from message fluxer.user.preferences.v1.RecentMentionsSettings
 */
export type RecentMentionsSettings = Message<"fluxer.user.preferences.v1.RecentMentionsSettings"> & {
  /**
   * @generated from field: optional bool include_everyone = 1;
   */
  includeEveryone?: boolean | undefined;

  /**
   * @generated from field: optional bool include_roles = 2;
   */
  includeRoles?: boolean | undefined;

  /**
   * @generated from field: optional bool include_guilds = 3;
   */
  includeGuilds?: boolean | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.RecentMentionsSettings.
 * Use `create(RecentMentionsSettingsSchema)` to create a new message.
 */
export const RecentMentionsSettingsSchema: GenMessage<RecentMentionsSettings> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 9);

/**
 * @generated from message fluxer.user.preferences.v1.MentionFrecencyState
 */
export type MentionFrecencyState = Message<"fluxer.user.preferences.v1.MentionFrecencyState"> & {
  /**
   * @generated from field: repeated fluxer.user.preferences.v1.MentionFrecencyState.Scope scopes = 1;
   */
  scopes: MentionFrecencyState_Scope[];
};

/**
 * Describes the message fluxer.user.preferences.v1.MentionFrecencyState.
 * Use `create(MentionFrecencyStateSchema)` to create a new message.
 */
export const MentionFrecencyStateSchema: GenMessage<MentionFrecencyState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 10);

/**
 * @generated from message fluxer.user.preferences.v1.MentionFrecencyState.Entry
 */
export type MentionFrecencyState_Entry = Message<"fluxer.user.preferences.v1.MentionFrecencyState.Entry"> & {
  /**
   * @generated from field: string user_id = 1;
   */
  userId: string;

  /**
   * @generated from field: uint32 count = 2;
   */
  count: number;

  /**
   * @generated from field: int64 last_at_ms = 3;
   */
  lastAtMs: bigint;
};

/**
 * Describes the message fluxer.user.preferences.v1.MentionFrecencyState.Entry.
 * Use `create(MentionFrecencyState_EntrySchema)` to create a new message.
 */
export const MentionFrecencyState_EntrySchema: GenMessage<MentionFrecencyState_Entry> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 10, 0);

/**
 * @generated from message fluxer.user.preferences.v1.MentionFrecencyState.Scope
 */
export type MentionFrecencyState_Scope = Message<"fluxer.user.preferences.v1.MentionFrecencyState.Scope"> & {
  /**
   * @generated from field: string guild_id = 1;
   */
  guildId: string;

  /**
   * @generated from field: repeated fluxer.user.preferences.v1.MentionFrecencyState.Entry entries = 2;
   */
  entries: MentionFrecencyState_Entry[];
};

/**
 * Describes the message fluxer.user.preferences.v1.MentionFrecencyState.Scope.
 * Use `create(MentionFrecencyState_ScopeSchema)` to create a new message.
 */
export const MentionFrecencyState_ScopeSchema: GenMessage<MentionFrecencyState_Scope> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 10, 1);

/**
 * @generated from message fluxer.user.preferences.v1.FavoritesState
 */
export type FavoritesState = Message<"fluxer.user.preferences.v1.FavoritesState"> & {
  /**
   * @generated from field: repeated fluxer.user.preferences.v1.FavoriteChannel channels = 1;
   */
  channels: FavoriteChannel[];

  /**
   * @generated from field: repeated fluxer.user.preferences.v1.FavoriteCategory categories = 2;
   */
  categories: FavoriteCategory[];

  /**
   * @generated from field: repeated string collapsed_category_ids = 3;
   */
  collapsedCategoryIds: string[];

  /**
   * @generated from field: bool hide_muted_channels = 4;
   */
  hideMutedChannels: boolean;

  /**
   * @generated from field: bool muted = 5;
   */
  muted: boolean;
};

/**
 * Describes the message fluxer.user.preferences.v1.FavoritesState.
 * Use `create(FavoritesStateSchema)` to create a new message.
 */
export const FavoritesStateSchema: GenMessage<FavoritesState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 11);

/**
 * @generated from message fluxer.user.preferences.v1.FavoriteChannel
 */
export type FavoriteChannel = Message<"fluxer.user.preferences.v1.FavoriteChannel"> & {
  /**
   * @generated from field: string channel_id = 1;
   */
  channelId: string;

  /**
   * @generated from field: string guild_id = 2;
   */
  guildId: string;

  /**
   * @generated from field: optional string parent_id = 3;
   */
  parentId?: string | undefined;

  /**
   * @generated from field: int32 position = 4;
   */
  position: number;

  /**
   * @generated from field: optional string nickname = 5;
   */
  nickname?: string | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.FavoriteChannel.
 * Use `create(FavoriteChannelSchema)` to create a new message.
 */
export const FavoriteChannelSchema: GenMessage<FavoriteChannel> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 12);

/**
 * @generated from message fluxer.user.preferences.v1.FavoriteCategory
 */
export type FavoriteCategory = Message<"fluxer.user.preferences.v1.FavoriteCategory"> & {
  /**
   * @generated from field: string id = 1;
   */
  id: string;

  /**
   * @generated from field: string name = 2;
   */
  name: string;

  /**
   * @generated from field: int32 position = 3;
   */
  position: number;
};

/**
 * Describes the message fluxer.user.preferences.v1.FavoriteCategory.
 * Use `create(FavoriteCategorySchema)` to create a new message.
 */
export const FavoriteCategorySchema: GenMessage<FavoriteCategory> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 13);

/**
 * @generated from message fluxer.user.preferences.v1.NagbarDismissals
 */
export type NagbarDismissals = Message<"fluxer.user.preferences.v1.NagbarDismissals"> & {
  /**
   * @generated from field: bool ios_install = 1;
   */
  iosInstall: boolean;

  /**
   * @generated from field: bool pwa_install = 2;
   */
  pwaInstall: boolean;

  /**
   * @generated from field: bool push_notification = 3;
   */
  pushNotification: boolean;

  /**
   * @generated from field: bool desktop_notification = 4;
   */
  desktopNotification: boolean;

  /**
   * @generated from field: bool premium_grace_period = 5;
   */
  premiumGracePeriod: boolean;

  /**
   * @generated from field: bool premium_expired = 6;
   */
  premiumExpired: boolean;

  /**
   * @generated from field: bool premium_onboarding = 7;
   */
  premiumOnboarding: boolean;

  /**
   * @generated from field: bool premium_trial_expiring = 8;
   */
  premiumTrialExpiring: boolean;

  /**
   * @generated from field: bool gift_inventory = 9;
   */
  giftInventory: boolean;

  /**
   * @generated from field: bool desktop_download = 10;
   */
  desktopDownload: boolean;

  /**
   * @generated from field: bool guild_membership_cta = 11;
   */
  guildMembershipCta: boolean;

  /**
   * @generated from field: bool visionary_mfa = 12;
   */
  visionaryMfa: boolean;

  /**
   * @generated from field: map<string, bool> pending_bulk_deletion = 15;
   */
  pendingBulkDeletion: { [key: string]: boolean };

  /**
   * @generated from field: map<string, bool> invites_disabled = 16;
   */
  invitesDisabled: { [key: string]: boolean };

  /**
   * @generated from field: map<string, bool> guild_mfa_requirement = 17;
   */
  guildMfaRequirement: { [key: string]: boolean };

  /**
   * @generated from field: map<string, bool> price_announcement = 18;
   */
  priceAnnouncement: { [key: string]: boolean };

  /**
   * @generated from field: map<string, bool> legacy_price_opt_in = 19;
   */
  legacyPriceOptIn: { [key: string]: boolean };
};

/**
 * Describes the message fluxer.user.preferences.v1.NagbarDismissals.
 * Use `create(NagbarDismissalsSchema)` to create a new message.
 */
export const NagbarDismissalsSchema: GenMessage<NagbarDismissals> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 14);

/**
 * @generated from message fluxer.user.preferences.v1.DismissedUpsells
 */
export type DismissedUpsells = Message<"fluxer.user.preferences.v1.DismissedUpsells"> & {
  /**
   * @generated from field: bool picker_premium = 1;
   */
  pickerPremium: boolean;
};

/**
 * Describes the message fluxer.user.preferences.v1.DismissedUpsells.
 * Use `create(DismissedUpsellsSchema)` to create a new message.
 */
export const DismissedUpsellsSchema: GenMessage<DismissedUpsells> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 15);

/**
 * @generated from message fluxer.user.preferences.v1.GuildNsfwAgreements
 */
export type GuildNsfwAgreements = Message<"fluxer.user.preferences.v1.GuildNsfwAgreements"> & {
  /**
   * @generated from field: repeated string agreed_channel_ids = 1;
   */
  agreedChannelIds: string[];

  /**
   * @generated from field: repeated string agreed_guild_ids = 2;
   */
  agreedGuildIds: string[];

  /**
   * @generated from field: repeated string agreed_category_ids = 3;
   */
  agreedCategoryIds: string[];
};

/**
 * Describes the message fluxer.user.preferences.v1.GuildNsfwAgreements.
 * Use `create(GuildNsfwAgreementsSchema)` to create a new message.
 */
export const GuildNsfwAgreementsSchema: GenMessage<GuildNsfwAgreements> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 16);

/**
 * @generated from message fluxer.user.preferences.v1.WhatsNewState
 */
export type WhatsNewState = Message<"fluxer.user.preferences.v1.WhatsNewState"> & {
  /**
   * @generated from field: optional string last_dismissed_entry_id = 1;
   */
  lastDismissedEntryId?: string | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.WhatsNewState.
 * Use `create(WhatsNewStateSchema)` to create a new message.
 */
export const WhatsNewStateSchema: GenMessage<WhatsNewState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 17);

/**
 * @generated from message fluxer.user.preferences.v1.PermissionLayoutSettings
 */
export type PermissionLayoutSettings = Message<"fluxer.user.preferences.v1.PermissionLayoutSettings"> & {
  /**
   * @generated from field: fluxer.user.preferences.v1.PermissionLayoutMode layout = 1;
   */
  layout: PermissionLayoutMode;

  /**
   * @generated from field: fluxer.user.preferences.v1.PermissionGridMode grid = 2;
   */
  grid: PermissionGridMode;
};

/**
 * Describes the message fluxer.user.preferences.v1.PermissionLayoutSettings.
 * Use `create(PermissionLayoutSettingsSchema)` to create a new message.
 */
export const PermissionLayoutSettingsSchema: GenMessage<PermissionLayoutSettings> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 18);

/**
 * @generated from message fluxer.user.preferences.v1.GuildMemberLayoutSettings
 */
export type GuildMemberLayoutSettings = Message<"fluxer.user.preferences.v1.GuildMemberLayoutSettings"> & {
  /**
   * @generated from field: fluxer.user.preferences.v1.GuildMemberViewMode mode = 1;
   */
  mode: GuildMemberViewMode;
};

/**
 * Describes the message fluxer.user.preferences.v1.GuildMemberLayoutSettings.
 * Use `create(GuildMemberLayoutSettingsSchema)` to create a new message.
 */
export const GuildMemberLayoutSettingsSchema: GenMessage<GuildMemberLayoutSettings> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 19);

/**
 * @generated from message fluxer.user.preferences.v1.GuildFolderExpandedState
 */
export type GuildFolderExpandedState = Message<"fluxer.user.preferences.v1.GuildFolderExpandedState"> & {
  /**
   * @generated from field: repeated fixed64 expanded_folder_ids = 1;
   */
  expandedFolderIds: bigint[];
};

/**
 * Describes the message fluxer.user.preferences.v1.GuildFolderExpandedState.
 * Use `create(GuildFolderExpandedStateSchema)` to create a new message.
 */
export const GuildFolderExpandedStateSchema: GenMessage<GuildFolderExpandedState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 20);

/**
 * @generated from message fluxer.user.preferences.v1.HiddenGuildListButtons
 */
export type HiddenGuildListButtons = Message<"fluxer.user.preferences.v1.HiddenGuildListButtons"> & {
  /**
   * @generated from field: bool download_button = 1;
   */
  downloadButton: boolean;

  /**
   * @generated from field: bool help_button = 2;
   */
  helpButton: boolean;
};

/**
 * Describes the message fluxer.user.preferences.v1.HiddenGuildListButtons.
 * Use `create(HiddenGuildListButtonsSchema)` to create a new message.
 */
export const HiddenGuildListButtonsSchema: GenMessage<HiddenGuildListButtons> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 21);

/**
 * @generated from message fluxer.user.preferences.v1.KeyboardModeIntroState
 */
export type KeyboardModeIntroState = Message<"fluxer.user.preferences.v1.KeyboardModeIntroState"> & {
  /**
   * @generated from field: bool seen = 1;
   */
  seen: boolean;
};

/**
 * Describes the message fluxer.user.preferences.v1.KeyboardModeIntroState.
 * Use `create(KeyboardModeIntroStateSchema)` to create a new message.
 */
export const KeyboardModeIntroStateSchema: GenMessage<KeyboardModeIntroState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 22);

/**
 * @generated from message fluxer.user.preferences.v1.InputMonitoringPromptsState
 */
export type InputMonitoringPromptsState = Message<"fluxer.user.preferences.v1.InputMonitoringPromptsState"> & {
  /**
   * @generated from field: bool seen_cta = 1;
   */
  seenCta: boolean;
};

/**
 * Describes the message fluxer.user.preferences.v1.InputMonitoringPromptsState.
 * Use `create(InputMonitoringPromptsStateSchema)` to create a new message.
 */
export const InputMonitoringPromptsStateSchema: GenMessage<InputMonitoringPromptsState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 23);

/**
 * @generated from message fluxer.user.preferences.v1.VoicePromptsState
 */
export type VoicePromptsState = Message<"fluxer.user.preferences.v1.VoicePromptsState"> & {
  /**
   * @generated from field: bool skip_hide_own_camera_confirm = 1;
   */
  skipHideOwnCameraConfirm: boolean;

  /**
   * @generated from field: bool skip_hide_own_screenshare_confirm = 2;
   */
  skipHideOwnScreenshareConfirm: boolean;

  /**
   * @generated from field: bool skip_p2p_join_confirm = 3;
   */
  skipP2pJoinConfirm: boolean;
};

/**
 * Describes the message fluxer.user.preferences.v1.VoicePromptsState.
 * Use `create(VoicePromptsStateSchema)` to create a new message.
 */
export const VoicePromptsStateSchema: GenMessage<VoicePromptsState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 24);

/**
 * @generated from message fluxer.user.preferences.v1.AnnouncementPromptsState
 */
export type AnnouncementPromptsState = Message<"fluxer.user.preferences.v1.AnnouncementPromptsState"> & {
  /**
   * @generated from field: bool hide_publish_nudge = 1;
   */
  hidePublishNudge: boolean;
};

/**
 * Describes the message fluxer.user.preferences.v1.AnnouncementPromptsState.
 * Use `create(AnnouncementPromptsStateSchema)` to create a new message.
 */
export const AnnouncementPromptsStateSchema: GenMessage<AnnouncementPromptsState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 25);

/**
 * @generated from message fluxer.user.preferences.v1.SudoPromptState
 */
export type SudoPromptState = Message<"fluxer.user.preferences.v1.SudoPromptState"> & {
  /**
   * @generated from field: optional fluxer.user.preferences.v1.MfaMethod last_used_mfa_method = 1;
   */
  lastUsedMfaMethod?: MfaMethod | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.SudoPromptState.
 * Use `create(SudoPromptStateSchema)` to create a new message.
 */
export const SudoPromptStateSchema: GenMessage<SudoPromptState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 26);

/**
 * @generated from message fluxer.user.preferences.v1.KeybindSettings
 */
export type KeybindSettings = Message<"fluxer.user.preferences.v1.KeybindSettings"> & {
  /**
   * @generated from field: repeated fluxer.user.preferences.v1.CustomKeybind custom_keybinds = 1;
   */
  customKeybinds: CustomKeybind[];

  /**
   * @generated from field: string transmit_mode = 2;
   */
  transmitMode: string;

  /**
   * @generated from field: optional uint32 push_to_talk_release_delay_ms = 3;
   */
  pushToTalkReleaseDelayMs?: number | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.KeybindSettings.
 * Use `create(KeybindSettingsSchema)` to create a new message.
 */
export const KeybindSettingsSchema: GenMessage<KeybindSettings> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 27);

/**
 * @generated from message fluxer.user.preferences.v1.CustomKeybind
 */
export type CustomKeybind = Message<"fluxer.user.preferences.v1.CustomKeybind"> & {
  /**
   * @generated from field: string id = 1;
   */
  id: string;

  /**
   * @generated from field: optional string action = 2;
   */
  action?: string | undefined;

  /**
   * @generated from field: fluxer.user.preferences.v1.KeybindCombo combo = 3;
   */
  combo?: KeybindCombo | undefined;

  /**
   * @generated from field: bool enabled = 4;
   */
  enabled: boolean;
};

/**
 * Describes the message fluxer.user.preferences.v1.CustomKeybind.
 * Use `create(CustomKeybindSchema)` to create a new message.
 */
export const CustomKeybindSchema: GenMessage<CustomKeybind> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 28);

/**
 * @generated from message fluxer.user.preferences.v1.KeybindCombo
 */
export type KeybindCombo = Message<"fluxer.user.preferences.v1.KeybindCombo"> & {
  /**
   * @generated from field: string key = 1;
   */
  key: string;

  /**
   * @generated from field: optional string code = 2;
   */
  code?: string | undefined;

  /**
   * @generated from field: bool ctrl_or_meta = 3;
   */
  ctrlOrMeta: boolean;

  /**
   * @generated from field: bool ctrl = 4;
   */
  ctrl: boolean;

  /**
   * @generated from field: bool alt = 5;
   */
  alt: boolean;

  /**
   * @generated from field: bool shift = 6;
   */
  shift: boolean;

  /**
   * @generated from field: bool meta = 7;
   */
  meta: boolean;

  /**
   * @generated from field: optional bool global = 8;
   */
  global?: boolean | undefined;

  /**
   * @generated from field: optional bool enabled = 9;
   */
  enabled?: boolean | undefined;

  /**
   * @generated from field: bool modifier_only = 10;
   */
  modifierOnly: boolean;

  /**
   * @generated from field: bool both_sides = 11;
   */
  bothSides: boolean;

  /**
   * @generated from field: optional uint32 mouse_button = 12;
   */
  mouseButton?: number | undefined;

  /**
   * @generated from field: optional uint32 gamepad_button = 13;
   */
  gamepadButton?: number | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.KeybindCombo.
 * Use `create(KeybindComboSchema)` to create a new message.
 */
export const KeybindComboSchema: GenMessage<KeybindCombo> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 29);

/**
 * @generated from message fluxer.user.preferences.v1.ChannelFrecencyEntry
 */
export type ChannelFrecencyEntry = Message<"fluxer.user.preferences.v1.ChannelFrecencyEntry"> & {
  /**
   * @generated from field: uint32 total_uses = 1;
   */
  totalUses: number;

  /**
   * @generated from field: repeated int64 recent_uses_ms = 2;
   */
  recentUsesMs: bigint[];
};

/**
 * Describes the message fluxer.user.preferences.v1.ChannelFrecencyEntry.
 * Use `create(ChannelFrecencyEntrySchema)` to create a new message.
 */
export const ChannelFrecencyEntrySchema: GenMessage<ChannelFrecencyEntry> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 30);

/**
 * @generated from message fluxer.user.preferences.v1.ChannelFrecencyState
 */
export type ChannelFrecencyState = Message<"fluxer.user.preferences.v1.ChannelFrecencyState"> & {
  /**
   * @generated from field: map<string, fluxer.user.preferences.v1.ChannelFrecencyEntry> usage = 1;
   */
  usage: { [key: string]: ChannelFrecencyEntry };
};

/**
 * Describes the message fluxer.user.preferences.v1.ChannelFrecencyState.
 * Use `create(ChannelFrecencyStateSchema)` to create a new message.
 */
export const ChannelFrecencyStateSchema: GenMessage<ChannelFrecencyState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 31);

/**
 * @generated from message fluxer.user.preferences.v1.ChatInputSettings
 */
export type ChatInputSettings = Message<"fluxer.user.preferences.v1.ChatInputSettings"> & {
  /**
   * @generated from field: optional bool convert_emoticons = 1;
   */
  convertEmoticons?: boolean | undefined;
};

/**
 * Describes the message fluxer.user.preferences.v1.ChatInputSettings.
 * Use `create(ChatInputSettingsSchema)` to create a new message.
 */
export const ChatInputSettingsSchema: GenMessage<ChatInputSettings> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 32);

/**
 * @generated from message fluxer.user.preferences.v1.ReactionEmoji
 */
export type ReactionEmoji = Message<"fluxer.user.preferences.v1.ReactionEmoji"> & {
  /**
   * @generated from field: optional string id = 1;
   */
  id?: string | undefined;

  /**
   * @generated from field: string name = 2;
   */
  name: string;
};

/**
 * Describes the message fluxer.user.preferences.v1.ReactionEmoji.
 * Use `create(ReactionEmojiSchema)` to create a new message.
 */
export const ReactionEmojiSchema: GenMessage<ReactionEmoji> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_preferences, 33);

/**
 * @generated from enum fluxer.user.preferences.v1.PermissionLayoutMode
 */
export enum PermissionLayoutMode {
  /**
   * @generated from enum value: PERMISSION_LAYOUT_MODE_UNSPECIFIED = 0;
   */
  UNSPECIFIED = 0,

  /**
   * @generated from enum value: PERMISSION_LAYOUT_MODE_COMFY = 1;
   */
  COMFY = 1,

  /**
   * @generated from enum value: PERMISSION_LAYOUT_MODE_DENSE = 2;
   */
  DENSE = 2,
}

/**
 * Describes the enum fluxer.user.preferences.v1.PermissionLayoutMode.
 */
export const PermissionLayoutModeSchema: GenEnum<PermissionLayoutMode> = /*@__PURE__*/
  enumDesc(file_fluxer_user_preferences_v1_preferences, 0);

/**
 * @generated from enum fluxer.user.preferences.v1.PermissionGridMode
 */
export enum PermissionGridMode {
  /**
   * @generated from enum value: PERMISSION_GRID_MODE_UNSPECIFIED = 0;
   */
  UNSPECIFIED = 0,

  /**
   * @generated from enum value: PERMISSION_GRID_MODE_SINGLE = 1;
   */
  SINGLE = 1,

  /**
   * @generated from enum value: PERMISSION_GRID_MODE_GRID = 2;
   */
  GRID = 2,
}

/**
 * Describes the enum fluxer.user.preferences.v1.PermissionGridMode.
 */
export const PermissionGridModeSchema: GenEnum<PermissionGridMode> = /*@__PURE__*/
  enumDesc(file_fluxer_user_preferences_v1_preferences, 1);

/**
 * @generated from enum fluxer.user.preferences.v1.GuildMemberViewMode
 */
export enum GuildMemberViewMode {
  /**
   * @generated from enum value: GUILD_MEMBER_VIEW_MODE_UNSPECIFIED = 0;
   */
  UNSPECIFIED = 0,

  /**
   * @generated from enum value: GUILD_MEMBER_VIEW_MODE_TABLE = 1;
   */
  TABLE = 1,

  /**
   * @generated from enum value: GUILD_MEMBER_VIEW_MODE_GRID = 2;
   */
  GRID = 2,
}

/**
 * Describes the enum fluxer.user.preferences.v1.GuildMemberViewMode.
 */
export const GuildMemberViewModeSchema: GenEnum<GuildMemberViewMode> = /*@__PURE__*/
  enumDesc(file_fluxer_user_preferences_v1_preferences, 2);

/**
 * @generated from enum fluxer.user.preferences.v1.MfaMethod
 */
export enum MfaMethod {
  /**
   * @generated from enum value: MFA_METHOD_UNSPECIFIED = 0;
   */
  UNSPECIFIED = 0,

  /**
   * @generated from enum value: MFA_METHOD_TOTP = 1;
   */
  TOTP = 1,

  /**
   * @generated from enum value: MFA_METHOD_WEBAUTHN = 3;
   */
  WEBAUTHN = 3,
}

/**
 * Describes the enum fluxer.user.preferences.v1.MfaMethod.
 */
export const MfaMethodSchema: GenEnum<MfaMethod> = /*@__PURE__*/
  enumDesc(file_fluxer_user_preferences_v1_preferences, 3);

/**
 * @generated from enum fluxer.user.preferences.v1.DoubleTapAction
 */
export enum DoubleTapAction {
  /**
   * @generated from enum value: DOUBLE_TAP_ACTION_UNSPECIFIED = 0;
   */
  UNSPECIFIED = 0,

  /**
   * @generated from enum value: DOUBLE_TAP_ACTION_REACT = 1;
   */
  REACT = 1,

  /**
   * @generated from enum value: DOUBLE_TAP_ACTION_EDIT = 2;
   */
  EDIT = 2,

  /**
   * @generated from enum value: DOUBLE_TAP_ACTION_NONE = 3;
   */
  NONE = 3,
}

/**
 * Describes the enum fluxer.user.preferences.v1.DoubleTapAction.
 */
export const DoubleTapActionSchema: GenEnum<DoubleTapAction> = /*@__PURE__*/
  enumDesc(file_fluxer_user_preferences_v1_preferences, 4);

/**
 * @generated from enum fluxer.user.preferences.v1.SwipeAction
 */
export enum SwipeAction {
  /**
   * @generated from enum value: SWIPE_ACTION_UNSPECIFIED = 0;
   */
  UNSPECIFIED = 0,

  /**
   * @generated from enum value: SWIPE_ACTION_CHANNEL_DETAILS = 1;
   */
  CHANNEL_DETAILS = 1,

  /**
   * @generated from enum value: SWIPE_ACTION_REPLY = 2;
   */
  REPLY = 2,
}

/**
 * Describes the enum fluxer.user.preferences.v1.SwipeAction.
 */
export const SwipeActionSchema: GenEnum<SwipeAction> = /*@__PURE__*/
  enumDesc(file_fluxer_user_preferences_v1_preferences, 5);

// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: the thread of a message in a DM thread (tyne-chat/tyne#699). The gateway pushes such a message as a
//! message in its DM, so apps that predate DM threads open the DM; newer apps read these keys to open the thread.

use serde_json::Value;

use crate::job::NotificationFields;

pub fn merge_fields(data: &mut Value, fields: &NotificationFields) {
    let Some(object) = data.as_object_mut() else {
        return;
    };
    for (key, value) in [
        ("fork_thread_id", fields.fork_thread_id.as_deref()),
        ("fork_thread_name", fields.fork_thread_name.as_deref()),
    ] {
        if let Some(value) = value.filter(|value| !value.is_empty()) {
            object.insert(key.to_owned(), value.into());
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::merge_fields;
    use crate::job::NotificationFields;

    fn fields(thread_id: Option<&str>, thread_name: Option<&str>) -> NotificationFields {
        serde_json::from_value(json!({
            "title": "Wren (Trip planning)",
            "body": "hi",
            "icon": "i",
            "tag": "channel:1:2",
            "notification_tag": "channel:1",
            "url": "/channels/@me/1/2",
            "fork_thread_id": thread_id,
            "fork_thread_name": thread_name,
        }))
        .expect("notification fields")
    }

    #[test]
    fn adds_the_thread_of_a_dm_thread_message() {
        let mut data = json!({"channel_id": "1"});
        merge_fields(&mut data, &fields(Some("3"), Some("Trip planning")));
        assert_eq!(data["fork_thread_id"], "3");
        assert_eq!(data["fork_thread_name"], "Trip planning");
        assert_eq!(data["channel_id"], "1");
    }

    #[test]
    fn leaves_other_messages_as_they_are() {
        let mut data = json!({"channel_id": "1"});
        merge_fields(&mut data, &fields(None, Some("")));
        assert_eq!(data, json!({"channel_id": "1"}));
    }

    // The job the gateway builds for a message in a 1:1 DM thread, as
    // fluxer_gateway/test/fluxer_gateway/fork/dm_thread_push_test.gleam (`thread_message_body`) pins it.
    const GATEWAY_THREAD_JOB: &str = r#"{"channel_id":"1400000000000000100","config_version":0,"guild_id":"0","message_id":"1400000000000000701","notification":{"author_name":"Wren","badge":"http://localhost:8088/marketing/branding/symbol-white.svg","body":"hi","conversation_kind":"dm","fork_thread_id":"1400000000000000700","fork_thread_name":"Trip planning","icon":"http://localhost:8088/avatars/3.png","image_url":null,"notification_tag":"channel:1400000000000000700","tag":"channel:1400000000000000700:1400000000000000701","title":"Wren (Trip planning)","url":"/channels/@me/1400000000000000100/1400000000000000701"},"user_ids":["1400000000000000001"],"v":1}"#;

    #[test]
    fn decodes_the_job_the_gateway_builds_for_a_dm_thread_message() {
        let job = crate::job::decode_message(GATEWAY_THREAD_JOB.as_bytes()).expect("job");
        assert!(job.is_direct_message());
        assert_eq!(job.channel_id, "1400000000000000100");
        assert_eq!(job.notification.title, "Wren (Trip planning)");
        assert_eq!(
            job.notification.fork_thread_id.as_deref(),
            Some("1400000000000000700")
        );
        assert_eq!(
            job.notification.fork_thread_name.as_deref(),
            Some("Trip planning")
        );
        assert_eq!(
            job.notification.tag,
            "channel:1400000000000000700:1400000000000000701"
        );
        assert_eq!(
            job.notification.notification_tag,
            "channel:1400000000000000700"
        );
    }

    // Why the gateway replaces the DM's tags with the thread's instead of adding them: a key given
    // twice is refused, and the push with it.
    #[test]
    fn refuses_a_job_with_a_tag_given_twice() {
        let twice = GATEWAY_THREAD_JOB.replacen("\"tag\":", "\"tag\":\"channel:1:2\",\"tag\":", 1);
        assert!(crate::job::decode_message(twice.as_bytes()).is_err());
    }
}

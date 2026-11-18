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
}

-- Notifications are no longer part of the functional product flow.
delete from outbox_events where event_type = 'notification.email';

delete from role_permissions
where permission_id in (
  select id from permissions where code in ('view.notifications', 'notifications.manage')
);

delete from permissions where code in ('view.notifications', 'notifications.manage');

drop table if exists notifications;
drop table if exists notification_email_settings;
drop table if exists notification_recipients;
drop table if exists notification_templates;

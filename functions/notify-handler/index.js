import { adminGql, ok } from '../_lib/hasura.js';

const MARK_DELIVERED = `
  mutation MarkDelivered($id: uuid!, $status: String!, $payload: jsonb) {
    update_notification_outbox_by_pk(
      pk_columns: { id: $id }
      _set: { delivery_status: $status, payload: $payload }
    ) {
      id
      delivery_status
    }
  }
`;

/**
 * Hasura Event Trigger handler for notification_outbox INSERT.
 * Implements notify step delivery (Slack webhook and/or console/email log).
 */
export default async function handler(req) {
  try {
    const body = await req.json();
    const row = body?.event?.data?.new;
    if (!row) {
      return ok({ success: false, message: 'No row in event' });
    }

    const channel = row.channel || 'log';
    const message = row.message || '';
    let delivery = { delivered_at: new Date().toISOString(), channel };

    if (channel === 'slack') {
      const webhookUrl =
        row.payload?.config?.slack_webhook_url ||
        process.env.SLACK_WEBHOOK_URL;
      if (webhookUrl) {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message }),
        });
        delivery.slack_status = res.status;
        if (!res.ok) {
          await adminGql(MARK_DELIVERED, {
            id: row.id,
            status: 'failed',
            payload: { ...row.payload, delivery, error: await res.text() },
          });
          return ok({ success: false, message: 'Slack delivery failed' });
        }
      } else {
        // No webhook configured — log and mark as logged
        console.log('[notify:slack:fallback]', message);
        delivery.note = 'No SLACK_WEBHOOK_URL; logged only';
      }
    } else if (channel === 'email') {
      // Free-tier friendly: log email payload (swap for Resend/SendGrid in prod)
      console.log('[notify:email]', {
        to: row.payload?.config?.to || process.env.NOTIFY_EMAIL_TO,
        message,
      });
      delivery.note = 'Email logged (configure provider for real send)';
    } else {
      console.log('[notify:log]', message, row.payload);
    }

    await adminGql(MARK_DELIVERED, {
      id: row.id,
      status: 'delivered',
      payload: { ...row.payload, delivery },
    });

    return ok({ success: true, id: row.id, delivery });
  } catch (err) {
    console.error('notify-handler error', err);
    return ok({ success: false, message: String(err.message || err) });
  }
}

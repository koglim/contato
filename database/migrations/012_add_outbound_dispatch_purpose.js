exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE channel_outbound_message_purpose AS ENUM (
      'customer_reply',
      'professional_contact_notification'
    );

    ALTER TABLE channel_outbound_messages
      ALTER COLUMN channel_inbound_message_id DROP NOT NULL,
      ADD COLUMN purpose channel_outbound_message_purpose NOT NULL DEFAULT 'customer_reply';

    ALTER TABLE channel_outbound_messages
      DROP CONSTRAINT IF EXISTS channel_outbound_messages_channel_inbound_message_id_key;
    CREATE UNIQUE INDEX channel_outbound_messages_customer_reply_inbound_uidx
      ON channel_outbound_messages(channel_inbound_message_id)
      WHERE channel_inbound_message_id IS NOT NULL;

    ALTER TABLE channel_outbound_messages
      ADD CONSTRAINT channel_outbound_messages_purpose_context_chk CHECK (
        (purpose = 'customer_reply' AND channel_inbound_message_id IS NOT NULL)
        OR (purpose = 'professional_contact_notification' AND channel_inbound_message_id IS NULL)
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE channel_outbound_messages
      DROP CONSTRAINT IF EXISTS channel_outbound_messages_purpose_context_chk;
    DROP INDEX IF EXISTS channel_outbound_messages_customer_reply_inbound_uidx;
    ALTER TABLE channel_outbound_messages
      DROP COLUMN purpose,
      ALTER COLUMN channel_inbound_message_id SET NOT NULL;
    ALTER TABLE channel_outbound_messages
      ADD CONSTRAINT channel_outbound_messages_channel_inbound_message_id_key UNIQUE (channel_inbound_message_id);
    DROP TYPE channel_outbound_message_purpose;
  `);
};

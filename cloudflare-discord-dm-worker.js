export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405);
    }

    const expectedSecret = env.WORKER_SECRET || '';
    if (expectedSecret) {
      const auth = request.headers.get('authorization') || '';
      if (auth !== `Bearer ${expectedSecret}`) {
        return json({ ok: false, error: 'Unauthorized' }, 401);
      }
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const botToken = normalizeBotToken(env.DISCORD_BOT_TOKEN || body.botToken || '');
    if (!botToken) return json({ ok: false, error: 'DISCORD_BOT_TOKEN is empty' }, 500);

    const recipientId = String(body.recipientId || body.discordId || '').trim();
    if (!/^\d{17,22}$/.test(recipientId)) {
      return json({ ok: false, error: 'Invalid recipientId' }, 400);
    }

    const payload = sanitizeDiscordPayload(body.payload || {});
    if (!payload.content && (!payload.embeds || !payload.embeds.length)) {
      return json({ ok: false, error: 'Empty Discord message' }, 400);
    }

    const headers = {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ProsecutorTrainingPortalWorker/1.0',
    };

    const channelResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers,
      body: JSON.stringify({ recipient_id: recipientId }),
    });

    const channelText = await channelResponse.text();
    if (!channelResponse.ok) {
      return json({ ok: false, stage: 'create_dm_channel', status: channelResponse.status, details: safeText(channelText) }, channelResponse.status);
    }

    const channel = JSON.parse(channelText);
    if (!channel.id) return json({ ok: false, error: 'Discord DM channel id is empty' }, 502);

    const messageResponse = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channel.id)}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const messageText = await messageResponse.text();
    if (!messageResponse.ok) {
      return json({ ok: false, stage: 'send_message', status: messageResponse.status, details: safeText(messageText) }, messageResponse.status);
    }

    return json({ ok: true, status: messageResponse.status, details: safeText(messageText) });
  },
};

function sanitizeDiscordPayload(input) {
  const payload = {};
  if (input.content) payload.content = String(input.content).slice(0, 1900);
  payload.allowed_mentions = { parse: [] };
  if (Array.isArray(input.embeds)) {
    payload.embeds = input.embeds.slice(0, 10).map((embed) => ({
      title: embed.title ? String(embed.title).slice(0, 256) : undefined,
      description: embed.description ? String(embed.description).slice(0, 4096) : undefined,
      color: Number(embed.color || 3447003),
      fields: Array.isArray(embed.fields)
        ? embed.fields.slice(0, 25).map((field) => ({
            name: String(field.name || '-').slice(0, 256),
            value: String(field.value || '-').slice(0, 1024),
            inline: Boolean(field.inline),
          }))
        : undefined,
      timestamp: embed.timestamp || new Date().toISOString(),
    }));
  }
  return payload;
}

function normalizeBotToken(token) {
  return String(token || '')
    .trim()
    .replace(/^Bot\s+/i, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function safeText(text) {
  return String(text || '').slice(0, 500);
}

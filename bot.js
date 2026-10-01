/* Bot Discord heberge avec le site (meme processus).
   - /setup : cree les roles et salons (noms decores), idempotent
   - annonces : nouvelles ressources, classement hebdo, moderation (boutons Valider / Refuser)
   - VIP : donne / retire le role Discord en meme temps que sur le site, et a l'expiration
   Variables : DISCORD_BOT_TOKEN, DISCORD_GUILD_ID (+ DISCORD_CLIENT_ID deja utilise pour la connexion). */
const {
  Client, GatewayIntentBits, Events, ChannelType, PermissionFlagsBits: P, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder
} = require('discord.js');

const ORANGE = 0xff5a1f, GOLD = 0xf5b942, GREEN = 0x4ade80, RED = 0xf87171, GREY = 0x71717a;
const EPHEMERAL = 64;
const sizeStr = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' Mo' : Math.ceil(b / 1024) + ' Ko');
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

module.exports = function startBot(ctx) {
  const { store, ranking, admins, baseUrl, grantVip, revokeVip, describe } = ctx;
  const { DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guildId, DISCORD_CLIENT_ID: clientId } = process.env;
  const noop = async () => {};
  const off = { enabled: false, resourceAdded: noop, resourceApproved: noop, reportAdded: noop, vipChanged: noop, status: async () => ({ enabled: false }) };
  if (!token || !guildId) { console.log('Bot Discord desactive (DISCORD_BOT_TOKEN et DISCORD_GUILD_ID non definis).'); return off; }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let ready = false, S = { roles: {}, channels: {}, cats: {} };
  const site = p => baseUrl.replace(/\/$/, '') + p;
  const guard = (label, fn) => async (...a) => { try { return await fn(...a); } catch (e) { console.error(`[bot] ${label} :`, e.message); } };
  const saveS = () => store.setSetting('discord', S);
  const getGuild = async () => client.guilds.cache.get(guildId) || client.guilds.fetch(guildId);
  const chan = async key => { const id = S.channels[key]; if (!id) return null; try { return await client.channels.fetch(id); } catch { return null; } };
  const send = async (key, payload) => { const c = await chan(key); if (c && c.isTextBased()) return c.send(payload); };
  const linkRow = (label, url) => new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url));

  /* ---------------- annonces ---------------- */
  const giveCreator = guard('role createur', async uid => {
    const g = await getGuild(), role = S.roles.creator && g.roles.cache.get(S.roles.creator); if (!role) return;
    const m = await g.members.fetch(uid).catch(() => null); if (m && !m.roles.cache.has(role.id)) await m.roles.add(role, 'Premiere ressource validee');
  });

  const resourceApproved = guard('annonce ressource', async r => {
    const d = await describe(r), vip = d.vipOnly;
    const e = new EmbedBuilder().setColor(vip ? GOLD : ORANGE).setTitle(cut((vip ? '★ ' : '') + r.title, 250)).setURL(site('/#/r/' + r.id))
      .setDescription(cut(r.description, 300) || '—')
      .addFields({ name: 'Catégorie', value: d.categoryName, inline: true }, { name: 'Créateur', value: cut(r.authorName, 60), inline: true }, { name: 'Taille', value: sizeStr(r.fileSize || 0), inline: true })
      .setFooter({ text: 'LEGEND · nouvelle ressource' }).setTimestamp(r.createdAt || Date.now());
    if (r.version) e.addFields({ name: 'Version', value: cut(r.version, 20), inline: true });
    if (r.framework) e.addFields({ name: 'Framework', value: cut(r.framework, 30), inline: true });
    if (r.images && r.images[0]) e.setImage(site('/img/' + r.images[0]));
    const ping = vip && S.roles.vip ? `<@&${S.roles.vip}>` : undefined;
    await send(vip ? 'vipNews' : 'newRes', { content: ping, embeds: [e], components: [linkRow(vip ? 'Voir (VIP)' : 'Voir sur le site', site('/#/r/' + r.id))], allowedMentions: { roles: S.roles.vip ? [S.roles.vip] : [] } });
    await giveCreator(r.authorId);
  });

  const pendingNotice = guard('moderation', async r => {
    const d = await describe(r);
    const e = new EmbedBuilder().setColor(GREY).setTitle('⏳ ' + cut(r.title, 240)).setURL(site('/#/r/' + r.id))
      .setDescription(cut(r.description, 400) || '—')
      .addFields({ name: 'Catégorie', value: d.categoryName, inline: true }, { name: 'Par', value: `${cut(r.authorName, 60)} (<@${r.authorId}>)`, inline: true }, { name: 'Taille', value: sizeStr(r.fileSize || 0), inline: true })
      .setFooter({ text: 'En attente de validation' }).setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('res:approve:' + r.id).setLabel('Valider').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('res:reject:' + r.id).setLabel('Refuser').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setLabel('Ouvrir').setStyle(ButtonStyle.Link).setURL(site('/#/r/' + r.id)));
    await send('mod', { embeds: [e], components: [row] });
  });
  const resourceAdded = guard('ressource ajoutee', async r => (r.status === 'approved' ? resourceApproved(r) : pendingNotice(r)));

  const reportAdded = guard('signalement', async (rep, r) => {
    const e = new EmbedBuilder().setColor(RED).setTitle('🚩 Signalement').setDescription(cut(rep.reason, 500))
      .addFields({ name: 'Ressource', value: r ? `[${cut(r.title, 80)}](${site('/#/r/' + r.id)})` : '(supprimée)', inline: true }, { name: 'Par', value: cut(rep.by, 60), inline: true }).setTimestamp();
    await send('mod', { embeds: [e] });
  });

  const vipChanged = guard('vip', async (uid, kind, until, by) => {
    const g = await getGuild(), role = S.roles.vip && g.roles.cache.get(S.roles.vip), m = await g.members.fetch(uid).catch(() => null);
    if (m && role) { if (kind === 'grant') await m.roles.add(role, 'VIP LEGEND'); else await m.roles.remove(role, 'VIP LEGEND'); }
    const txt = kind === 'grant' ? `★ VIP donné à <@${uid}> — ${until ? 'jusqu\'au <t:' + Math.floor(until / 1000) + ':D>' : '**à vie**'}` : kind === 'expired' ? `⌛ VIP expiré pour <@${uid}>` : `✖ VIP retiré à <@${uid}>`;
    await send('logs', { embeds: [new EmbedBuilder().setColor(kind === 'grant' ? GOLD : GREY).setDescription(txt + (by ? `\nPar ${cut(by, 60)}` : '')).setTimestamp()], allowedMentions: { parse: [] } });
    if (kind === 'grant' && m) await m.send({ embeds: [new EmbedBuilder().setColor(GOLD).setTitle('★ Tu es VIP !').setDescription(until ? `Ton accès VIP est actif jusqu'au <t:${Math.floor(until / 1000)}:D>.` : 'Ton accès VIP est actif **à vie**.').setURL(site('/#/vip'))] }).catch(() => {});
  });

  /* classement hebdomadaire : chaque lundi (a partir de 8h UTC), une seule fois */
  const weekly = guard('classement hebdo', async () => {
    const now = new Date(); if (!ready || now.getUTCDay() !== 1 || now.getUTCHours() < 8) return;
    const key = now.toISOString().slice(0, 10); if ((await store.setting('rankingPosted')) === key) return;
    const list = (await ranking(Date.now() - 7 * 864e5, Date.now())).slice(0, 10);
    await store.setSetting('rankingPosted', key); if (!list.length) return;
    const medals = ['🥇', '🥈', '🥉'];
    const e = new EmbedBuilder().setColor(ORANGE).setTitle('🏆 Classement de la semaine').setURL(site('/#/classement'))
      .setDescription(list.map((u, i) => `${medals[i] || `**${i + 1}.**`} **${cut(u.name, 40)}** — ${u.downloads} téléchargement${u.downloads > 1 ? 's' : ''} · ${u.resources} ressource${u.resources > 1 ? 's' : ''}`).join('\n')).setFooter({ text: 'LEGEND · 7 derniers jours' }).setTimestamp();
    await send('ranking', { embeds: [e], components: [linkRow('Voir le classement', site('/#/classement'))] });
  });

  /* ---------------- /setup : roles + salons ---------------- */
  const PLAN = [
    { cat: 'infos', name: '━━━━ INFORMATIONS ━━━━', scope: 'public', ch: [
      { key: 'rules', name: '📜┃règlement', ro: true, topic: 'Les règles du serveur — à lire avant de participer.' },
      { key: 'announce', name: '📢┃annonces', ro: true, topic: 'Les annonces officielles.' },
      { key: 'site', name: '🌐┃site-web', ro: true, topic: 'Le site LEGEND : ressources, classement, outils.' }] },
    { cat: 'ressources', name: '━━━━ RESSOURCES ━━━━', scope: 'public', ch: [
      { key: 'newRes', name: '📦┃nouvelles-ressources', ro: true, topic: 'Chaque nouvelle ressource validée apparaît ici.' },
      { key: 'ranking', name: '🏆┃classement', ro: true, topic: 'Le classement des créateurs, chaque lundi.' },
      { key: 'requests', name: '🛠️┃demandes', topic: 'Demande une ressource à la communauté.' }] },
    { cat: 'community', name: '━━━━ COMMUNAUTÉ ━━━━', scope: 'public', ch: [
      { key: 'chat', name: '💬┃discussion', topic: 'Discussion générale.' },
      { key: 'media', name: '📸┃médias', topic: 'Captures, clips et créations.' },
      { key: 'suggestions', name: '💡┃suggestions', topic: 'Une idée pour le site ou le serveur ? Dis-le ici.' },
      { key: 'support', name: '🆘┃support', topic: 'Besoin d\'aide ? Pose ta question.' }] },
    { cat: 'vip', name: '━━━━ ★ VIP ━━━━', scope: 'vip', ch: [
      { key: 'vipNews', name: '★┃nouveautés-vip', ro: true, topic: 'Les ressources exclusives VIP.' },
      { key: 'vipChat', name: '★┃chat-vip', topic: 'Le salon des membres VIP.' }] },
    { cat: 'staff', name: '━━━━ STAFF ━━━━', scope: 'staff', ch: [
      { key: 'mod', name: '🛡️┃modération', topic: 'Validation des ressources et signalements.' },
      { key: 'logs', name: '🧾┃logs', topic: 'Journal : VIP, actions du bot.' },
      { key: 'botCmd', name: '🤖┃commandes-bot', topic: '/setup, /vip donner, /vip retirer, /vip statut' }] },
    { cat: 'voice', name: '━━━━ VOCAUX ━━━━', scope: 'public', voice: [
      { key: 'vc1', name: '🔊┃Général' }, { key: 'vc2', name: '🎧┃Détente' }, { key: 'vcVip', name: '★┃Salon VIP', scope: 'vip' }] }
  ];
  const ROLES = [
    { key: 'staff', name: '⚙️┃Staff', color: ORANGE, hoist: true, perms: [P.ManageMessages, P.ModerateMembers, P.ViewAuditLog, P.MuteMembers, P.MoveMembers] },
    { key: 'vip', name: '★┃VIP', color: GOLD, hoist: true, perms: [] },
    { key: 'creator', name: '🛠️┃Créateur', color: GREEN, hoist: true, perms: [] }
  ];

  async function setupGuild(g, progress) {
    const made = [], kept = [];
    await g.roles.fetch(); await g.channels.fetch();
    const everyone = g.roles.everyone.id, botId = client.user.id, R = {};
    for (const d of ROLES) {
      let role = (S.roles[d.key] && g.roles.cache.get(S.roles[d.key])) || g.roles.cache.find(r => r.name === d.name);
      if (!role) { role = await g.roles.create({ name: d.name, color: d.color, hoist: d.hoist, permissions: d.perms, mentionable: false, reason: 'LEGEND setup' }); made.push('rôle ' + d.name); }
      else { await role.edit({ color: d.color, hoist: d.hoist }).catch(() => {}); kept.push('rôle ' + d.name); }
      S.roles[d.key] = role.id; R[d.key] = role;
    }
    await progress('Rôles prêts. Création des salons…');
    const botAllow = { id: botId, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages, P.Connect] };
    const ov = (scope, ro, voice) => {
      const out = [];
      if (scope === 'public') out.push({ id: everyone, allow: [P.ViewChannel, P.ReadMessageHistory], deny: ro ? [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads] : [] });
      if (scope === 'vip') {
        out.push({ id: everyone, deny: [P.ViewChannel] });
        out.push({ id: R.vip.id, allow: voice ? [P.ViewChannel, P.Connect, P.Speak] : [P.ViewChannel, P.ReadMessageHistory, ...(ro ? [] : [P.SendMessages])], deny: ro && !voice ? [P.SendMessages] : [] });
        out.push({ id: R.staff.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.Connect] });
      }
      if (scope === 'staff') { out.push({ id: everyone, deny: [P.ViewChannel] }); out.push({ id: R.staff.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] }); }
      out.push(botAllow); return out;
    };
    const find = (key, name, type, parentId) => {
      const byId = S.channels[key] && g.channels.cache.get(S.channels[key]); if (byId) return byId;
      return g.channels.cache.find(c => c.name === name && c.type === type && (c.parentId || null) === (parentId || null));
    };
    const ensure = async (key, name, type, parentId, extra, overwrites) => {
      let ch = find(key, name, type, parentId);
      if (!ch) { ch = await g.channels.create({ name, type, parent: parentId || undefined, permissionOverwrites: overwrites, ...extra, reason: 'LEGEND setup' }); made.push(name); }
      else { await ch.edit({ name, parent: parentId || null, permissionOverwrites: overwrites, ...extra }).catch(() => {}); kept.push(name); }
      S.channels[key] = ch.id; return ch;
    };
    for (const c of PLAN) {
      const cat = await ensure('cat:' + c.cat, c.name, ChannelType.GuildCategory, null, {}, ov(c.scope, false, false));
      for (const d of c.ch || []) await ensure(d.key, d.name, ChannelType.GuildText, cat.id, { topic: d.topic }, ov(c.scope, !!d.ro, false));
      for (const d of c.voice || []) await ensure(d.key, d.name, ChannelType.GuildVoice, cat.id, {}, ov(d.scope || c.scope, false, true));
      await progress(`Catégorie « ${c.name.replace(/━/g, '').trim()} » prête.`);
    }
    // Staff : tous les admins du site recoivent le role
    for (const uid of admins) { const m = await g.members.fetch(uid).catch(() => null); if (m && !m.roles.cache.has(R.staff.id)) await m.roles.add(R.staff, 'Admin du site').catch(() => {}); }
    // messages d'accueil (une seule fois)
    const empty = async ch => ch && ch.isTextBased() && (await ch.messages.fetch({ limit: 1 }).catch(() => ({ size: 1 }))).size === 0;
    const rules = await chan('rules'), web = await chan('site');
    if (await empty(rules)) await rules.send({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('📜 Règlement').setDescription([
      '**1.** Respecte tout le monde : pas d\'insultes, de harcèlement ni de discrimination.',
      '**2.** Pas de spam, de publicité ni de liens douteux.',
      '**3.** Partage uniquement des ressources dont tu es l\'auteur ou dont la licence l\'autorise. Les scripts payants piratés ou volés sont **interdits**.',
      '**4.** Les décisions du staff sont à respecter ; en cas de souci, contacte le support.',
      '**5.** Un contenu pose problème ? Utilise le bouton « Signaler » sur le site.'].join('\n\n')).setFooter({ text: 'En restant sur ce serveur, tu acceptes ces règles.' })] });
    if (await empty(web)) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Ouvrir le site').setStyle(ButtonStyle.Link).setURL(site('/')),
        new ButtonBuilder().setLabel('Passe VIP').setStyle(ButtonStyle.Link).setURL(site('/#/vip')),
        new ButtonBuilder().setLabel('Classement').setStyle(ButtonStyle.Link).setURL(site('/#/classement')));
      await web.send({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('🌐 LEGEND').setDescription('Ressources FiveM partagées par la communauté, classement des créateurs, passe VIP et outils gratuits (écran de chargement, bannières Discord).')], components: [row] });
    }
    await saveS();
    return { made, kept };
  }

  /* ---------------- commandes + boutons ---------------- */
  const COMMANDS = [
    new SlashCommandBuilder().setName('setup').setDescription('Crée ou met à jour les rôles et salons du serveur').setDefaultMemberPermissions(P.Administrator).setDMPermission(false),
    new SlashCommandBuilder().setName('vip').setDescription('Gérer les membres VIP').setDefaultMemberPermissions(P.Administrator).setDMPermission(false)
      .addSubcommand(s => s.setName('donner').setDescription('Donner ou prolonger le VIP')
        .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption(o => o.setName('duree').setDescription('Durée').setRequired(true).addChoices({ name: '7 jours', value: 7 }, { name: '30 jours', value: 30 }, { name: '90 jours', value: 90 }, { name: '6 mois', value: 180 }, { name: '1 an', value: 365 }, { name: 'À vie', value: -1 })))
      .addSubcommand(s => s.setName('retirer').setDescription('Retirer le VIP').addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)))
      .addSubcommand(s => s.setName('statut').setDescription('Voir le VIP d\'un membre').addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)))
  ].map(c => c.toJSON());

  client.on(Events.InteractionCreate, async i => {
    try {
      if (i.isChatInputCommand()) {
        if (!admins.has(i.user.id)) return i.reply({ content: 'Réservé aux admins du site.', flags: EPHEMERAL });
        if (i.commandName === 'setup') {
          await i.deferReply({ flags: EPHEMERAL });
          try {
            const r = await setupGuild(i.guild, msg => i.editReply(msg).catch(() => {}));
            return i.editReply({ content: `✅ **Serveur prêt.**\nCréé : ${r.made.length ? r.made.map(x => '`' + x + '`').join(', ') : 'rien de nouveau'}\nDéjà en place : ${r.kept.length} élément(s) mis à jour.\nLes annonces arrivent dans <#${S.channels.newRes}>, la modération dans <#${S.channels.mod}>.` });
          } catch (e) { console.error('[bot] setup :', e); return i.editReply('❌ Échec : ' + cut(e.message, 300) + '\nVérifie que le bot a les permissions **Gérer les salons** et **Gérer les rôles**, et que son rôle est placé tout en haut de la liste des rôles.'); }
        }
        if (i.commandName === 'vip') {
          const sub = i.options.getSubcommand(), u = i.options.getUser('membre');
          await i.deferReply({ flags: EPHEMERAL });
          await store.upsertUser({ id: u.id, name: u.globalName || u.username, avatar: u.displayAvatarURL({ extension: 'png', size: 128 }), lastLogin: 0 });
          if (sub === 'donner') { const d = i.options.getInteger('duree'), until = await grantVip(u.id, d === -1 ? null : d, i.user.globalName || i.user.username); return i.editReply(`★ VIP donné à ${u} — ${until ? 'jusqu\'au <t:' + Math.floor(until / 1000) + ':D>' : '**à vie**'}`); }
          if (sub === 'retirer') { await revokeVip(u.id, i.user.globalName || i.user.username); return i.editReply(`✖ VIP retiré à ${u}.`); }
          const v = await store.vip(u.id), active = v && (v.until === null || v.until > Date.now());
          return i.editReply(active ? `★ ${u} est VIP — ${v.until === null ? '**à vie**' : 'jusqu\'au <t:' + Math.floor(v.until / 1000) + ':D>'}` : `${u} n'est pas VIP.`);
        }
      } else if (i.isButton() && i.customId.startsWith('res:')) {
        if (!admins.has(i.user.id)) return i.reply({ content: 'Réservé aux admins du site.', flags: EPHEMERAL });
        const [, act, id] = i.customId.split(':'), r = await store.resource(id);
        if (!r) return i.update({ components: [], embeds: i.message.embeds, content: 'Ressource introuvable.' });
        if (r.status !== 'pending') return i.update({ components: [] });
        const ok = act === 'approve'; await store.setStatus(id, ok ? 'approved' : 'rejected');
        const e = EmbedBuilder.from(i.message.embeds[0]).setColor(ok ? GREEN : RED).setFooter({ text: `${ok ? 'Validée' : 'Refusée'} par ${i.user.globalName || i.user.username}` });
        await i.update({ embeds: [e], components: [] });
        if (ok) await resourceApproved({ ...r, status: 'approved' });
      }
    } catch (e) {
      console.error('[bot] interaction :', e.message);
      if (i.isRepliable() && !i.replied && !i.deferred) i.reply({ content: 'Erreur interne.', flags: EPHEMERAL }).catch(() => {});
    }
  });

  client.once(Events.ClientReady, async () => {
    try {
      S = { roles: {}, channels: {}, cats: {}, ...((await store.setting('discord')) || {}) };
      const g = await getGuild(); await g.roles.fetch(); await g.channels.fetch();
      await g.commands.set(COMMANDS);
      // remet le role VIP aux membres VIP actifs (au cas ou il aurait ete perdu)
      const role = S.roles.vip && g.roles.cache.get(S.roles.vip);
      if (role) for (const v of await store.vips()) if (v.until === null || v.until > Date.now()) { const m = await g.members.fetch(v.userId).catch(() => null); if (m && !m.roles.cache.has(role.id)) await m.roles.add(role, 'Synchronisation VIP').catch(() => {}); }
      ready = true; console.log(`Bot Discord pret : ${client.user.tag} sur « ${g.name} »${S.channels.newRes ? '' : ' (tape /setup sur le serveur pour creer les salons)'}`);
      setInterval(weekly, 30 * 60 * 1000).unref(); weekly();
    } catch (e) { console.error('[bot] demarrage :', e.message, '— le bot est-il bien invite sur le serveur ?'); }
  });
  client.on(Events.Error, e => console.error('[bot]', e.message));
  client.login(token).catch(e => console.error('[bot] connexion impossible :', e.message));

  const invite = clientId ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=8` : null;
  return {
    enabled: true, resourceAdded, resourceApproved, reportAdded, vipChanged,
    status: async () => ({ enabled: true, ready, tag: client.user && client.user.tag, guild: ready ? (await getGuild()).name : null, setupDone: !!S.channels.newRes, channels: S.channels, roles: S.roles, invite })
  };
};

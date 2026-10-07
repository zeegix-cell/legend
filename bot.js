/* Bot Discord heberge avec le site (meme processus).
   - /setup : cree la hierarchie de roles et les salons (style "• INFOS", un salon par categorie), idempotent
   - /nettoyer : supprime les salons et roles qui ne font pas partie de LEGEND (apres confirmation)
   - annonces "Nouvel ajout", apercu VIP public, moderation par boutons, menu de roles de notification
   - VIP : role Discord synchronise avec le site, retire a l'expiration
   Variables : DISCORD_BOT_TOKEN, DISCORD_GUILD_ID (+ DISCORD_CLIENT_ID deja utilise pour la connexion). */
const {
  Client, GatewayIntentBits, Events, ChannelType, PermissionFlagsBits: P, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder
} = require('discord.js');

const ORANGE = 0xff5a1f, GOLD = 0xf5b942, GREEN = 0x4ade80, RED = 0xf87171, GREY = 0x71717a;
const EPHEMERAL = 64;
const sizeStr = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' Mo' : Math.ceil(b / 1024) + ' Ko');
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const catTitle = n => `• ${n}`;
const chName = (emoji, n) => `${emoji}・${String(n).toLowerCase().replace(/\s+/g, '-')}`.slice(0, 100);
const EMOJI = { armes: '🔫', autres: '📁', bases: '🏗️', bundles: '📦', 'loading-screen': '🖥️', mappings: '🗺️', 'pack-graphique': '🎨', scripts: '⚙️', 'template-discord': '💬', ui: '🧩', vehicles: '🚗', vetements: '👕', vip: '⭐' };
const emo = id => EMOJI[id] || '📁';
const firstEmoji = s => { const m = /^(\p{Extended_Pictographic}️?)/u.exec(s); return m ? m[1] : null; };

module.exports = function startBot(ctx) {
  const { store, ranking, admins, baseUrl, grantVip, revokeVip, describe, categories } = ctx;
  const { DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guildId, DISCORD_CLIENT_ID: clientId } = process.env;
  const noop = async () => {};
  const off = { enabled: false, resourceAdded: noop, resourceApproved: noop, reportAdded: noop, vipChanged: noop, status: async () => ({ enabled: false }) };
  if (!token || !guildId) { console.log('Bot Discord desactive (DISCORD_BOT_TOKEN et DISCORD_GUILD_ID non definis).'); return off; }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let ready = false, S = { roles: {}, channels: {}, menus: [] };
  const site = p => baseUrl.replace(/\/$/, '') + p;
  const guard = (label, fn) => async (...a) => { try { return await fn(...a); } catch (e) { console.error(`[bot] ${label} :`, e.message); } };
  const saveS = () => store.setSetting('discord', S);
  const getGuild = async () => client.guilds.cache.get(guildId) || client.guilds.fetch(guildId);
  const chan = async key => { const id = S.channels[key]; if (!id) return null; try { return await client.channels.fetch(id); } catch { return null; } };
  const send = async (key, payload) => { const c = await chan(key); if (c && c.isTextBased()) return c.send(payload); };
  const link = (label, url) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);

  /* ---------------- hierarchie de roles ---------------- */
  const ROLES = [
    { key: 'sep1', name: '━━━ ÉQUIPE ━━━', color: 0x3f3f46 },
    { key: 'direction', name: '👑・Direction', color: 0xef4444, hoist: true, perms: [P.ManageGuild, P.ManageChannels, P.ManageRoles, P.ManageMessages, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ViewAuditLog, P.MentionEveryone, P.ManageNicknames, P.MuteMembers, P.DeafenMembers, P.MoveMembers] },
    { key: 'admin', old: ['staff'], oldNames: ['⚙️・Staff', '⚙️┃Staff'], name: '🛡️・Administrateur', color: 0xf97316, hoist: true, perms: [P.ManageChannels, P.ManageMessages, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ViewAuditLog, P.ManageNicknames, P.MentionEveryone] },
    { key: 'mod', name: '🔨・Modérateur', color: 0xfacc15, hoist: true, perms: [P.ManageMessages, P.ModerateMembers, P.MuteMembers, P.MoveMembers, P.ManageNicknames, P.ViewAuditLog] },
    { key: 'support', name: '🎧・Support', color: 0x38bdf8, hoist: true, perms: [P.ManageMessages, P.ModerateMembers] },
    { key: 'sep2', name: '━━━ COMMUNAUTÉ ━━━', color: 0x3f3f46 },
    { key: 'vip', oldNames: ['★┃VIP', '⭐・VIP'], name: '⭐・VIP', color: GOLD, hoist: true },
    { key: 'top', name: '🏆・Top de la semaine', color: 0xfb923c, hoist: true },
    { key: 'creator', oldNames: ['🛠️┃Créateur'], name: '🛠️・Créateur', color: GREEN, hoist: true },
    { key: 'sep3', name: '━━━ NOTIFICATIONS ━━━', color: 0x3f3f46 },
    { key: 'n_news', name: '🔔・Nouveautés', color: 0x71717a, mention: true },
    { key: 'n_give', name: '🎁・Giveaways', color: 0x71717a, mention: true },
    { key: 'n_ann', name: '📢・Annonces', color: 0x71717a, mention: true }
  ];
  const STAFF_KEYS = ['direction', 'admin', 'mod', 'support'];
  const catRoleName = c => cut(`🔔・${c.name}`, 100);

  async function ensureRoles(g, siteCats, made, kept) {
    await g.roles.fetch();
    const defs = [...ROLES, ...siteCats.filter(c => !c.vipOnly).map(c => ({ key: 'c:' + c.id, name: catRoleName(c), color: 0x52525b, mention: true }))];
    const objs = [];
    for (const d of defs) {
      const ids = [S.roles[d.key], ...(d.old || []).map(k => S.roles[k])].filter(Boolean);
      let role = ids.map(id => g.roles.cache.get(id)).find(Boolean) || g.roles.cache.find(r => r.name === d.name || (d.oldNames || []).includes(r.name));
      const data = { name: d.name, color: d.color, hoist: !!d.hoist, mentionable: !!d.mention, permissions: d.perms || [] };
      if (!role) { role = await g.roles.create({ ...data, reason: 'LEGEND setup' }); made.push('rôle ' + d.name); }
      else { await role.edit(data).catch(() => {}); kept.push('rôle ' + d.name); }
      S.roles[d.key] = role.id; objs.push(role);
    }
    // ordre de la hierarchie (le plus haut = Direction), sous le role du bot
    try {
      const top = g.members.me && g.members.me.roles && g.members.me.roles.highest ? g.members.me.roles.highest.position : 0;
      if (top - 1 - objs.length >= 1) await g.roles.setPositions(objs.map((r, i) => ({ role: r.id, position: top - 1 - i })));
    } catch (e) { console.error('[bot] ordre des roles :', e.message); }
    return objs;
  }

  /* menu de roles : l'utilisateur choisit ses notifications avec des boutons */
  const menuKeys = () => Object.keys(S.roles).filter(k => /^(n_|c:)/.test(k));
  async function postRoleMenu(g) {
    const ch = await chan('roles'); if (!ch) return;
    for (const id of S.menus || []) { const m = await ch.messages.fetch(id).catch(() => null); if (m) await m.delete().catch(() => {}); }
    const items = menuKeys().map(k => ({ key: k, role: g.roles.cache.get(S.roles[k]) })).filter(x => x.role);
    const ids = [];
    for (let i = 0; i < items.length; i += 25) {
      const rows = [], chunk = items.slice(i, i + 25);
      for (let j = 0; j < chunk.length; j += 5) rows.push(new ActionRowBuilder().addComponents(chunk.slice(j, j + 5).map(x => {
        const b = new ButtonBuilder().setCustomId('role:' + x.key).setLabel(cut(x.role.name.replace(/^.*?・/, ''), 80)).setStyle(ButtonStyle.Secondary), em = firstEmoji(x.role.name); if (em) b.setEmoji(em); return b; })));
      const payload = { components: rows };
      if (i === 0) payload.embeds = [new EmbedBuilder().setColor(ORANGE).setTitle('🎭 Tes notifications').setDescription('Clique sur un bouton pour **recevoir** (ou arrêter de recevoir) les annonces.\n\n🔔 **Nouveautés** · 🎁 **Giveaways** · 📢 **Annonces**\nEt un rôle par **catégorie** : tu es prévenu à chaque nouvel ajout dans celles qui t\'intéressent.')];
      ids.push((await ch.send(payload)).id);
    }
    S.menus = ids; await saveS();
  }
  const categoryRole = async c => {   // role de notification d'une nouvelle categorie du site
    if (c.vipOnly || !S.channels['cat:ressources']) return null;
    const g = await getGuild(); await g.roles.fetch();
    let role = S.roles['c:' + c.id] && g.roles.cache.get(S.roles['c:' + c.id]);
    if (!role) { role = await g.roles.create({ name: catRoleName(c), color: 0x52525b, mentionable: true, reason: 'Categorie du site' }); S.roles['c:' + c.id] = role.id; await saveS(); await postRoleMenu(g).catch(() => {}); }
    return role;
  };

  /* ---------------- droits des salons ---------------- */
  const botAllow = () => ({ id: client.user.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages, P.Connect] });
  function overwrites(g, scope, ro, voice) {
    const ev = g.roles.everyone.id, out = [], staff = STAFF_KEYS.map(k => S.roles[k]).filter(Boolean);
    if (scope === 'public') out.push({ id: ev, allow: [P.ViewChannel, P.ReadMessageHistory], deny: ro ? [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads] : [] });
    if (scope === 'vip') {
      out.push({ id: ev, deny: [P.ViewChannel] });
      out.push({ id: S.roles.vip, allow: voice ? [P.ViewChannel, P.Connect, P.Speak] : [P.ViewChannel, P.ReadMessageHistory, ...(ro ? [] : [P.SendMessages])], deny: ro && !voice ? [P.SendMessages] : [] });
      for (const id of staff) out.push({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.Connect] });
    }
    if (scope === 'staff') { out.push({ id: ev, deny: [P.ViewChannel] }); for (const id of staff) out.push({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] }); }
    out.push(botAllow()); return out;
  }

  async function categoryChannel(c) {   // un salon par categorie du site (cree a la demande)
    const g = await getGuild(); await g.channels.fetch();
    const parentId = S.channels[c.vipOnly ? 'cat:vip' : 'cat:ressources']; if (!parentId) return null;
    const name = chName(emo(c.id), c.name), key = 'rc:' + c.id, scope = c.vipOnly ? 'vip' : 'public';
    let ch = (S.channels[key] && g.channels.cache.get(S.channels[key])) || g.channels.cache.find(x => x.type === ChannelType.GuildText && x.name === name && x.parentId === parentId);
    const topic = `Nouveautés — ${c.name}`;
    if (!ch) ch = await g.channels.create({ name, type: ChannelType.GuildText, parent: parentId, topic, permissionOverwrites: overwrites(g, scope, true, false), reason: 'Categorie du site' });
    else if (ch.name !== name || ch.parentId !== parentId) await ch.edit({ name, parent: parentId, topic, permissionOverwrites: overwrites(g, scope, true, false) }).catch(() => {});
    if (S.channels[key] !== ch.id) { S.channels[key] = ch.id; await saveS(); }
    return ch;
  }

  /* ---------------- annonces ---------------- */
  const giveCreator = guard('role createur', async uid => {
    const g = await getGuild(), role = S.roles.creator && g.roles.cache.get(S.roles.creator); if (!role) return;
    const m = await g.members.fetch(uid).catch(() => null); if (m && !m.roles.cache.has(role.id)) await m.roles.add(role, 'Premiere ressource validee');
  });

  const resourceApproved = guard('annonce ressource', async r => {
    const d = await describe(r), vip = d.vipOnly, url = site('/#/r/' + r.id), ts = Math.floor((r.createdAt || Date.now()) / 1000);
    const infos = [r.version && `v${cut(r.version, 20)}`, r.framework, r.fileSize && sizeStr(r.fileSize)].filter(Boolean).join(' · ');
    const lines = [
      `**Nom :** [${cut(r.title, 120)}](${url})`,
      `**Catégorie :** [${d.categoryName}](${site('/#/ressources/' + encodeURIComponent(d.categoryId))})`,
      `**Accès :** ${vip ? '⭐ VIP' : 'Gratuit'}`,
      `**Par :** ${cut(r.authorName, 60)}`,
      `**Publié :** <t:${ts}:R>`
    ];
    if (infos) lines.push(`**Infos :** ${infos}`);
    const desc = cut(r.description, 220).replace(/\s*\n\s*/g, ' ').trim();
    const e = new EmbedBuilder().setColor(vip ? GOLD : ORANGE).setAuthor({ name: 'LEGEND', iconURL: site('/logo.png'), url: site('/') })
      .setTitle(`${emo(d.categoryId)} Nouvel ajout — ${d.categoryName}`).setURL(url)
      .setDescription('Une ressource a été ajoutée sur le site.\n\n' + lines.join('\n') + (desc ? `\n\n> ${desc}` : ''))
      .setFooter({ text: vip ? 'LEGEND · zone VIP' : 'LEGEND · ressources FiveM' }).setTimestamp(r.createdAt || Date.now());
    if (r.images && r.images[0]) e.setImage(site('/img/' + r.images[0]));
    const row = new ActionRowBuilder().addComponents(link(vip ? 'Voir (VIP)' : 'Voir et télécharger', url), link('Catégorie · ' + cut(d.categoryName, 40), site('/#/ressources/' + encodeURIComponent(d.categoryId))));
    const catRole = vip ? null : await categoryRole({ id: d.categoryId, name: d.categoryName, vipOnly: false }).catch(() => null);
    const pingId = vip ? S.roles.vip : catRole && catRole.id;
    const target = (await categoryChannel({ id: d.categoryId, name: d.categoryName, vipOnly: vip }).catch(() => null)) || (await chan('announce'));
    if (target) await target.send({ content: pingId ? `<@&${pingId}>` : undefined, embeds: [e], components: [row], allowedMentions: { roles: pingId ? [pingId] : [] } });
    if (vip) {   // apercu public (sans lien de telechargement) pour donner envie
      const t = new EmbedBuilder().setColor(GOLD).setAuthor({ name: 'LEGEND', iconURL: site('/logo.png') }).setTitle('⭐ Nouveauté VIP — ' + cut(r.title, 200))
        .setDescription(`Une ressource exclusive vient d'arriver dans la **zone VIP**.\n\n**Catégorie :** ${d.categoryName}\n**Par :** ${cut(r.authorName, 60)}`).setFooter({ text: 'Réservé aux membres VIP' }).setTimestamp();
      if (r.images && r.images[0]) t.setImage(site('/img/' + r.images[0]));
      await send('vipPreview', { embeds: [t], components: [new ActionRowBuilder().addComponents(link('Devenir VIP', site('/#/vip')))] });
    }
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
      new ButtonBuilder().setCustomId('res:reject:' + r.id).setLabel('Refuser').setStyle(ButtonStyle.Danger), link('Ouvrir', site('/#/r/' + r.id)));
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
    const txt = kind === 'grant' ? `⭐ VIP donné à <@${uid}> — ${until ? 'jusqu\'au <t:' + Math.floor(until / 1000) + ':D>' : '**à vie**'}` : kind === 'expired' ? `⌛ VIP expiré pour <@${uid}>` : `✖ VIP retiré à <@${uid}>`;
    await send('logs', { embeds: [new EmbedBuilder().setColor(kind === 'grant' ? GOLD : GREY).setDescription(txt + (by ? `\nPar ${cut(by, 60)}` : '')).setTimestamp()], allowedMentions: { parse: [] } });
    if (kind === 'grant' && m) await m.send({ embeds: [new EmbedBuilder().setColor(GOLD).setTitle('⭐ Tu es VIP !').setDescription(until ? `Ton accès VIP est actif jusqu'au <t:${Math.floor(until / 1000)}:D>.` : 'Ton accès VIP est actif **à vie**.').setURL(site('/#/vip'))] }).catch(() => {});
  });

  /* classement hebdomadaire : chaque lundi (8h UTC), une seule fois + role "Top de la semaine" */
  const weekly = guard('classement hebdo', async () => {
    const now = new Date(); if (!ready || now.getUTCDay() !== 1 || now.getUTCHours() < 8) return;
    const key = now.toISOString().slice(0, 10); if ((await store.setting('rankingPosted')) === key) return;
    const list = (await ranking(Date.now() - 7 * 864e5, Date.now())).slice(0, 10);
    await store.setSetting('rankingPosted', key); if (!list.length) return;
    const medals = ['🥇', '🥈', '🥉'];
    const e = new EmbedBuilder().setColor(ORANGE).setTitle('🏆 Classement de la semaine').setURL(site('/#/classement'))
      .setDescription(list.map((u, i) => `${medals[i] || `**${i + 1}.**`} **${cut(u.name, 40)}** — ${u.downloads} téléchargement${u.downloads > 1 ? 's' : ''} · ${u.resources} ressource${u.resources > 1 ? 's' : ''}`).join('\n')).setFooter({ text: 'LEGEND · 7 derniers jours' }).setTimestamp();
    await send('ranking', { embeds: [e], components: [new ActionRowBuilder().addComponents(link('Voir le classement', site('/#/classement')))] });
    const g = await getGuild(), role = S.roles.top && g.roles.cache.get(S.roles.top), prev = await store.setting('topWinner');
    if (role) {
      if (prev && prev !== list[0].id) { const pm = await g.members.fetch(prev).catch(() => null); if (pm) await pm.roles.remove(role, 'Fin de semaine').catch(() => {}); }
      const wm = await g.members.fetch(list[0].id).catch(() => null); if (wm) await wm.roles.add(role, 'Top de la semaine').catch(() => {});
    }
    await store.setSetting('topWinner', list[0].id);
  });

  /* ---------------- /setup : roles + salons ---------------- */
  const PLAN = [
    { key: 'infos', name: 'INFOS', scope: 'public', ch: [
      { key: 'rules', e: '📜', n: 'règlement', ro: true, topic: 'Les règles du serveur — à lire avant de participer.' },
      { key: 'info', e: 'ℹ️', n: 'informations', ro: true, topic: 'Tout savoir sur LEGEND.' },
      { key: 'announce', e: '📢', n: 'annonces', ro: true, topic: 'Les annonces officielles.' },
      { key: 'roles', e: '🎭', n: 'rôles', ro: true, topic: 'Choisis tes notifications.' },
      { key: 'giveaway', e: '🎁', n: 'giveaway', ro: true, topic: 'Concours et cadeaux.' }] },
    { key: 'siteweb', name: 'SITE WEB', scope: 'public', ch: [
      { key: 'site', e: '🌐', n: 'site-officiel', ro: true, topic: 'Le site LEGEND : ressources, classement, outils.' },
      { key: 'ranking', e: '🏆', n: 'classement', ro: true, topic: 'Le classement des créateurs, chaque lundi.' },
      { key: 'patch', e: '🗒️', n: 'patch-notes', ro: true, topic: 'Les mises à jour du site.' }] },
    { key: 'ressources', name: 'RESSOURCES', scope: 'public', cats: 'public', ch: [
      { key: 'requests', e: '🛠️', n: 'demandes', topic: 'Demande une ressource à la communauté.' }] },
    { key: 'accesVip', name: 'ACCÈS VIP', scope: 'public', ch: [
      { key: 'vipInfo', e: '⭐', n: 'devenir-vip', ro: true, topic: 'Comment obtenir le VIP.' },
      { key: 'vipPreview', e: '👀', n: 'aperçu-vip', ro: true, topic: 'Aperçu des ressources exclusives VIP.' }] },
    { key: 'vip', name: 'ZONE VIP', scope: 'vip', cats: 'vip', ch: [
      { key: 'vipChat', e: '💬', n: 'chat-vip', topic: 'Le salon des membres VIP.' }] },
    { key: 'community', name: 'COMMUNAUTÉ', scope: 'public', ch: [
      { key: 'chat', e: '💬', n: 'discussion', topic: 'Discussion générale.' },
      { key: 'media', e: '📸', n: 'médias', topic: 'Captures, clips et créations.' },
      { key: 'suggestions', e: '💡', n: 'suggestions', topic: 'Une idée pour le site ou le serveur ? Dis-le ici.' }] },
    { key: 'support', name: 'SUPPORT', scope: 'public', ch: [
      { key: 'support', e: '🆘', n: 'support', topic: 'Besoin d\'aide ? Pose ta question.' }] },
    { key: 'staff', name: 'STAFF', scope: 'staff', ch: [
      { key: 'mod', e: '🛡️', n: 'modération', topic: 'Validation des ressources et signalements.' },
      { key: 'logs', e: '🧾', n: 'logs', topic: 'Journal : VIP, actions du bot.' },
      { key: 'botCmd', e: '🤖', n: 'commandes-bot', topic: '/setup, /nettoyer, /vip donner, /vip retirer, /vip statut' }] },
    { key: 'voice', name: 'VOCAUX', scope: 'public', voice: [
      { key: 'vc1', e: '🔊', n: 'Général' }, { key: 'vc2', e: '🎧', n: 'Détente' }, { key: 'vcVip', e: '⭐', n: 'Salon VIP', scope: 'vip' }] }
  ];
  const LEGACY = ['newRes', 'vipNews'];

  async function setupGuild(g, progress) {
    const made = [], kept = [];
    await g.channels.fetch();
    const siteCats = await categories();
    await ensureRoles(g, siteCats, made, kept);
    await progress('Rôles prêts. Création des salons…');
    const find = (key, name, type, parentId) => {
      const byId = S.channels[key] && g.channels.cache.get(S.channels[key]); if (byId) return byId;
      return g.channels.cache.find(c => c.name === name && c.type === type && (c.parentId || null) === (parentId || null));
    };
    const ensure = async (key, name, type, parentId, extra, ov) => {
      let ch = find(key, name, type, parentId);
      if (!ch) { ch = await g.channels.create({ name, type, parent: parentId || undefined, permissionOverwrites: ov, ...extra, reason: 'LEGEND setup' }); made.push(name); }
      else { await ch.edit({ name, parent: parentId || null, permissionOverwrites: ov, ...extra }).catch(() => {}); kept.push(name); }
      S.channels[key] = ch.id; return ch;
    };
    for (const c of PLAN) {
      const cat = await ensure('cat:' + c.key, catTitle(c.name), ChannelType.GuildCategory, null, {}, overwrites(g, c.scope, false, false));
      for (const d of c.ch || []) await ensure(d.key, chName(d.e, d.n), ChannelType.GuildText, cat.id, { topic: d.topic }, overwrites(g, c.scope, !!d.ro, false));
      for (const d of c.voice || []) await ensure(d.key, chName(d.e, d.n), ChannelType.GuildVoice, cat.id, {}, overwrites(g, d.scope || c.scope, false, true));
      if (c.cats) for (const sc of siteCats.filter(x => (c.cats === 'vip') === !!x.vipOnly)) {
        const before = !!S.channels['rc:' + sc.id]; const ch = await categoryChannel(sc);
        if (ch) (before ? kept : made).push(ch.name);
      }
      await progress(`Section « ${catTitle(c.name)} » prête.`);
    }
    // l'equipe du site recoit le role Direction
    const dir = g.roles.cache.get(S.roles.direction);
    for (const uid of admins) { const m = await g.members.fetch(uid).catch(() => null); if (m && dir && !m.roles.cache.has(dir.id)) await m.roles.add(dir, 'Admin du site').catch(() => {}); }
    // messages d'accueil (une seule fois par salon)
    const empty = async ch => ch && ch.isTextBased() && (await ch.messages.fetch({ limit: 1 }).catch(() => ({ size: 1 }))).size === 0;
    const rules = await chan('rules'), info = await chan('info'), web = await chan('site'), vipInfo = await chan('vipInfo');
    if (await empty(rules)) await rules.send({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('📜 Règlement').setDescription([
      '**1.** Respecte tout le monde : pas d\'insultes, de harcèlement ni de discrimination.',
      '**2.** Pas de spam, de publicité ni de liens douteux.',
      '**3.** Partage uniquement des ressources dont tu es l\'auteur ou dont la licence l\'autorise. Les scripts payants piratés ou volés sont **interdits**.',
      '**4.** Les décisions du staff sont à respecter ; en cas de souci, ouvre un ticket dans le support.',
      '**5.** Un contenu pose problème ? Utilise le bouton « Signaler » sur le site.'].join('\n\n')).setFooter({ text: 'En restant sur ce serveur, tu acceptes ces règles.' })] });
    if (await empty(info)) await info.send({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('ℹ️ LEGEND').setDescription('Des ressources FiveM partagées par la communauté, vérifiées avant publication.\n\n• Une **catégorie = un salon** : chaque nouvel ajout est annoncé dans la section **RESSOURCES**.\n• Choisis tes **notifications** dans <#' + (S.channels.roles || '') + '>.\n• Le **classement** des créateurs est publié chaque lundi.\n• Le **passe VIP** donne accès aux ressources exclusives.\n• Des **outils gratuits** : écran de chargement FiveM et bannières Discord animées.')] });
    if (await empty(web)) await web.send({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('🌐 Site officiel').setDescription('Toutes les ressources, le classement et les outils sont sur le site.')], components: [new ActionRowBuilder().addComponents(link('Ouvrir le site', site('/')), link('Ressources', site('/#/ressources')), link('Classement', site('/#/classement')), link('Outils', site('/#/tools/banner')))] });
    if (await empty(vipInfo)) await vipInfo.send({ embeds: [new EmbedBuilder().setColor(GOLD).setTitle('⭐ Passe VIP').setDescription('Le VIP donne accès à la **zone VIP** : des ressources exclusives, un salon privé et les modèles premium des outils.\n\nIl est attribué par l\'équipe, pour une durée limitée ou à vie, et s\'arrête automatiquement à la fin de la période.\n\nRegarde <#' + (S.channels.vipPreview || '') + '> pour un aperçu des dernières nouveautés.')], components: [new ActionRowBuilder().addComponents(link('Découvrir le VIP', site('/#/vip')))] });
    await postRoleMenu(g);
    for (const k of LEGEND_REMOVE()) delete S.channels[k];
    await saveS();
    return { made, kept };
  }
  const LEGEND_REMOVE = () => LEGACY.filter(k => S.channels[k]);

  /* ---------------- /nettoyer : supprime tout ce qui n'est pas LEGEND ---------------- */
  const pending = new Map();   // nonce -> { userId, ts, withRoles }
  async function cleanPlan(g, keepChannelId, withRoles) {
    await g.channels.fetch(); await g.roles.fetch();
    const keepCh = new Set([...Object.values(S.channels), keepChannelId, g.rulesChannelId, g.publicUpdatesChannelId].filter(Boolean));
    const chs = [...g.channels.cache.values()].filter(c => !keepCh.has(c.id));
    const keepRoles = new Set(Object.values(S.roles));
    const botTop = g.members.me && g.members.me.roles && g.members.me.roles.highest ? g.members.me.roles.highest.position : 0;
    const cand = withRoles ? [...g.roles.cache.values()].filter(r => r.id !== g.id && !r.managed && !keepRoles.has(r.id) && r.position < botTop) : [];
    const rolesDel = cand.filter(r => !(r.permissions && r.permissions.has(P.Administrator)));
    const rolesAdmin = cand.filter(r => r.permissions && r.permissions.has(P.Administrator));
    return { chs, rolesDel, rolesAdmin };
  }
  const listNames = (arr, f) => { const l = arr.slice(0, 18).map(f).join(', '); return (l || '—') + (arr.length > 18 ? `… (+${arr.length - 18})` : ''); };
  async function cleanPrompt(g, channelId, userId, withRoles) {
    const plan = await cleanPlan(g, channelId, withRoles), nonce = Math.random().toString(36).slice(2, 10);
    pending.set(nonce, { userId, ts: Date.now(), withRoles, channelId });
    for (const [k, v] of pending) if (Date.now() - v.ts > 120000) pending.delete(k);
    const e = new EmbedBuilder().setColor(RED).setTitle('🧹 Nettoyage du serveur')
      .setDescription('Ces éléments **ne font pas partie de LEGEND** et seront **supprimés définitivement** :')
      .addFields({ name: `Salons et catégories (${plan.chs.length})`, value: cut(listNames(plan.chs, c => '`' + c.name + '`'), 1000) },
        ...(withRoles ? [{ name: `Rôles (${plan.rolesDel.length})`, value: cut(listNames(plan.rolesDel, r => '`' + r.name + '`'), 1000) }] : []),
        ...(plan.rolesAdmin.length ? [{ name: `Rôles administrateur conservés par sécurité (${plan.rolesAdmin.length})`, value: cut(listNames(plan.rolesAdmin, r => '`' + r.name + '`'), 1000) }] : []))
      .setFooter({ text: 'Le salon actuel, les rôles du bot et @everyone sont conservés. Expire dans 2 minutes.' });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('clean:yes:' + nonce).setLabel(`Tout supprimer (${plan.chs.length + (withRoles ? plan.rolesDel.length : 0)})`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('clean:no:' + nonce).setLabel('Annuler').setStyle(ButtonStyle.Secondary));
    return { plan, embeds: [e], components: (plan.chs.length || plan.rolesDel.length) ? [row] : [] };
  }
  async function cleanRun(g, plan, progress) {
    let ch = 0, ro = 0, fail = 0;
    const ordered = [...plan.chs.filter(c => c.type !== ChannelType.GuildCategory), ...plan.chs.filter(c => c.type === ChannelType.GuildCategory)];
    for (const c of ordered) { try { await c.delete('Nettoyage LEGEND'); ch++; } catch { fail++; } }
    await progress(`Salons supprimés : ${ch}. Suppression des rôles…`);
    for (const r of plan.rolesDel) { try { await r.delete('Nettoyage LEGEND'); ro++; } catch { fail++; } }
    return { ch, ro, fail };
  }

  /* ---------------- commandes + boutons ---------------- */
  const COMMANDS = [
    new SlashCommandBuilder().setName('setup').setDescription('Crée ou met à jour les rôles et salons du serveur').setDefaultMemberPermissions(P.Administrator).setDMPermission(false)
      .addBooleanOption(o => o.setName('nettoyer').setDescription('Propose ensuite de supprimer les anciens salons et rôles (avec confirmation)')),
    new SlashCommandBuilder().setName('nettoyer').setDescription('Supprime les salons et rôles qui ne font pas partie de LEGEND (avec confirmation)').setDefaultMemberPermissions(P.Administrator).setDMPermission(false)
      .addBooleanOption(o => o.setName('roles').setDescription('Supprimer aussi les anciens rôles (oui par défaut)')),
    new SlashCommandBuilder().setName('vip').setDescription('Gérer les membres VIP').setDefaultMemberPermissions(P.Administrator).setDMPermission(false)
      .addSubcommand(s => s.setName('donner').setDescription('Donner ou prolonger le VIP')
        .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption(o => o.setName('duree').setDescription('Durée').setRequired(true).addChoices({ name: '7 jours', value: 7 }, { name: '30 jours', value: 30 }, { name: '90 jours', value: 90 }, { name: '6 mois', value: 180 }, { name: '1 an', value: 365 }, { name: 'À vie', value: -1 })))
      .addSubcommand(s => s.setName('retirer').setDescription('Retirer le VIP').addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)))
      .addSubcommand(s => s.setName('statut').setDescription('Voir le VIP d\'un membre').addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)))
  ].map(c => c.toJSON());
  const optBool = (i, name, def) => { try { const v = i.options && i.options.getBoolean(name); return v === null || v === undefined ? def : v; } catch { return def; } };

  client.on(Events.InteractionCreate, async i => {
    try {
      if (i.isChatInputCommand()) {
        if (!admins.has(i.user.id)) return i.reply({ content: 'Réservé aux admins du site.', flags: EPHEMERAL });
        if (i.commandName === 'setup') {
          await i.deferReply({ flags: EPHEMERAL });
          try {
            const r = await setupGuild(i.guild, msg => i.editReply(msg).catch(() => {}));
            const first = Object.keys(S.channels).find(k => k.startsWith('rc:'));
            const summary = `✅ **Serveur prêt.**\nCréé : ${r.made.length ? r.made.slice(0, 30).map(x => '`' + x + '`').join(', ') : 'rien de nouveau'}${r.made.length > 30 ? '…' : ''}\nDéjà en place : ${r.kept.length} élément(s) mis à jour.\nChaque nouvel ajout est annoncé dans le salon de sa catégorie${first ? ` (ex : <#${S.channels[first]}>)` : ''} ; choisis tes notifications dans <#${S.channels.roles}>.`;
            if (optBool(i, 'nettoyer', false)) { const cp = await cleanPrompt(i.guild, i.channelId, i.user.id, true); return i.editReply({ content: summary + '\n\n⬇️ **Dernière étape :** confirme le nettoyage ci-dessous (ou ignore ce message pour tout garder).', embeds: cp.embeds, components: cp.components }); }
            return i.editReply({ content: summary + '\n\n💡 Pour supprimer les anciens salons et rôles : `/nettoyer`.' });
          } catch (e) { console.error('[bot] setup :', e); return i.editReply('❌ Échec : ' + cut(e.message, 300) + '\nVérifie que le bot a les permissions **Gérer les salons** et **Gérer les rôles**, et que son rôle est placé tout en haut de la liste des rôles.'); }
        }
        if (i.commandName === 'nettoyer') {
          await i.deferReply({ flags: EPHEMERAL });
          if (!S.channels['cat:ressources']) return i.editReply('Lance d\'abord `/setup` : sans ça, je ne sais pas quels salons garder.');
          const cp = await cleanPrompt(i.guild, i.channelId, i.user.id, optBool(i, 'roles', true));
          return i.editReply(cp.components.length ? { embeds: cp.embeds, components: cp.components } : { content: '✨ Rien à nettoyer : il n\'y a que des éléments LEGEND.' });
        }
        if (i.commandName === 'vip') {
          const sub = i.options.getSubcommand(), u = i.options.getUser('membre');
          await i.deferReply({ flags: EPHEMERAL });
          await store.upsertUser({ id: u.id, name: u.globalName || u.username, avatar: u.displayAvatarURL({ extension: 'png', size: 128 }), lastLogin: 0 });
          if (sub === 'donner') { const d = i.options.getInteger('duree'), until = await grantVip(u.id, d === -1 ? null : d, i.user.globalName || i.user.username); return i.editReply(`⭐ VIP donné à ${u} — ${until ? 'jusqu\'au <t:' + Math.floor(until / 1000) + ':D>' : '**à vie**'}`); }
          if (sub === 'retirer') { await revokeVip(u.id, i.user.globalName || i.user.username); return i.editReply(`✖ VIP retiré à ${u}.`); }
          const v = await store.vip(u.id), active = v && (v.until === null || v.until > Date.now());
          return i.editReply(active ? `⭐ ${u} est VIP — ${v.until === null ? '**à vie**' : 'jusqu\'au <t:' + Math.floor(v.until / 1000) + ':D>'}` : `${u} n'est pas VIP.`);
        }
      } else if (i.isButton() && i.customId.startsWith('role:')) {
        const key = i.customId.slice(5);   // seuls les roles de notification sont attribuables
        if (!/^(n_|c:)/.test(key)) return i.reply({ content: 'Rôle non disponible.', flags: EPHEMERAL });
        const role = S.roles[key] && i.guild.roles.cache.get(S.roles[key]);
        if (!role) return i.reply({ content: 'Rôle introuvable : un admin doit relancer `/setup`.', flags: EPHEMERAL });
        const has = i.member.roles.cache.has(role.id);
        if (has) await i.member.roles.remove(role, 'Menu de roles'); else await i.member.roles.add(role, 'Menu de roles');
        return i.reply({ content: has ? `➖ Tu ne recevras plus : **${role.name}**` : `➕ Tu recevras : **${role.name}**`, flags: EPHEMERAL });
      } else if (i.isButton() && i.customId.startsWith('clean:')) {
        const [, act, nonce] = i.customId.split(':'), p = pending.get(nonce);
        if (!admins.has(i.user.id) || !p || p.userId !== i.user.id) return i.reply({ content: 'Action non autorisée ou expirée : relance la commande.', flags: EPHEMERAL });
        pending.delete(nonce);
        if (act === 'no' || Date.now() - p.ts > 120000) return i.update({ content: act === 'no' ? 'Nettoyage annulé.' : 'Confirmation expirée : relance la commande.', embeds: [], components: [] });
        await i.update({ content: '🧹 Nettoyage en cours…', embeds: [], components: [] });
        const plan = await cleanPlan(i.guild, p.channelId, p.withRoles);
        const res = await cleanRun(i.guild, plan, msg => i.editReply({ content: msg }).catch(() => {}));
        return i.editReply({ content: `✅ **Nettoyage terminé** : ${res.ch} salon(s)/catégorie(s) et ${res.ro} rôle(s) supprimé(s)${res.fail ? `, ${res.fail} impossible(s) à supprimer (salons de communauté ou rôles au-dessus du bot)` : ''}.` });
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
      S = { roles: {}, channels: {}, menus: [], ...((await store.setting('discord')) || {}) };
      const g = await getGuild(); await g.roles.fetch(); await g.channels.fetch();
      await g.commands.set(COMMANDS);
      const role = S.roles.vip && g.roles.cache.get(S.roles.vip);
      if (role) for (const v of await store.vips()) if (v.until === null || v.until > Date.now()) { const m = await g.members.fetch(v.userId).catch(() => null); if (m && !m.roles.cache.has(role.id)) await m.roles.add(role, 'Synchronisation VIP').catch(() => {}); }
      ready = true; console.log(`Bot Discord pret : ${client.user.tag} sur « ${g.name} »${S.channels['cat:ressources'] ? '' : ' (tape /setup sur le serveur pour creer les salons)'}`);
      setInterval(weekly, 30 * 60 * 1000).unref(); weekly();
    } catch (e) { console.error('[bot] demarrage :', e.message, '— le bot est-il bien invite sur le serveur ?'); }
  });
  client.on(Events.Error, e => console.error('[bot]', e.message));
  client.login(token).catch(e => console.error('[bot] connexion impossible :', e.message));

  const invite = clientId ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=8` : null;
  return {
    enabled: true, resourceAdded, resourceApproved, reportAdded, vipChanged,
    status: async () => ({ enabled: true, ready, tag: client.user && client.user.tag, guild: ready ? (await getGuild()).name : null, setupDone: !!S.channels['cat:ressources'], channels: S.channels, roles: S.roles, invite })
  };
};

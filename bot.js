/* Bot Discord heberge avec le site (meme processus).
   - /setup : cree la hierarchie de roles et les salons (style "• INFOS", un salon par categorie), idempotent
   - /nettoyer : supprime les salons et roles qui ne font pas partie de LEGEND (apres confirmation)
   - annonces "Nouvel ajout", apercu VIP public, moderation par boutons, menu de roles de notification
   - VIP : role Discord synchronise avec le site, retire a l'expiration
   Variables : DISCORD_BOT_TOKEN, DISCORD_GUILD_ID (+ DISCORD_CLIENT_ID deja utilise pour la connexion). */
const {
  Client, GatewayIntentBits, Events, ChannelType, PermissionFlagsBits: P, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, AttachmentBuilder
} = require('discord.js');

let cards = null;   // images generees (cartes d'annonce et bannieres) ; le bot marche aussi sans
try { cards = require('./cards'); } catch (e) { console.log('Cartes visuelles desactivees :', e.message); }

const ORANGE = 0xff5a1f, GOLD = 0xf5b942, GREEN = 0x4ade80, RED = 0xf87171, GREY = 0x71717a;
const EPHEMERAL = 64;
const sizeStr = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' Mo' : Math.ceil(b / 1024) + ' Ko');
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const fs = require('fs'), path = require('path');
const catTitle = n => `• ${n}`;
const chName = (emoji, n) => `${emoji}・${String(n).toLowerCase().replace(/\s+/g, '-')}`.slice(0, 100);
const EMOJI = { armes: '🔫', autres: '📁', bases: '🏗️', bundles: '📦', 'loading-screen': '🖥️', mappings: '🗺️', 'pack-graphique': '🎨', scripts: '⚙️', 'template-discord': '💬', ui: '🧩', vehicles: '🚗', vetements: '👕', vip: '⭐' };
const emo = id => EMOJI[id] || '📁';
const firstEmoji = s => { const m = /^(\p{Extended_Pictographic}️?)/u.exec(s); return m ? m[1] : null; };

module.exports = function startBot(ctx) {
  const { store, ranking, admins, baseUrl, grantVip, revokeVip, describe, categories, readImage, badgeCatalogue, memberBadges, evaluateUser, awardBadge, statsOf } = ctx;
  const { DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guildId, DISCORD_CLIENT_ID: clientId } = process.env;
  const noop = async () => {};
  const off = { enabled: false, resourceAdded: noop, resourceApproved: noop, reportAdded: noop, vipChanged: noop, badgeAwarded: noop, badgesChanged: noop, orderPaid: noop, status: async () => ({ enabled: false }) };
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
  const BROAD = [P.ManageGuild, P.ManageChannels, P.ManageRoles, P.ManageMessages, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ViewAuditLog, P.MentionEveryone, P.ManageNicknames, P.MuteMembers, P.DeafenMembers, P.MoveMembers];
  const ROLES = [
    { key: 'sep1', name: '━━━ ÉQUIPE ━━━', color: 0x3f3f46 },
    { key: 'founder', old: ['direction'], name: '👑・Fondateur', color: 0xef4444, hoist: true, perms: BROAD },
    { key: 'cofounder', name: '💎・Co-Fondateur', color: 0xec4899, hoist: true, perms: BROAD },
    { key: 'manager', name: '👔・Responsable', color: 0xa855f7, hoist: true, perms: [P.ManageChannels, P.ManageMessages, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ViewAuditLog, P.ManageNicknames, P.MentionEveryone] },
    { key: 'dev', name: '💻・Développeur', color: 0x6366f1, hoist: true, perms: [] },
    { key: 'admin', old: ['staff'], oldNames: ['⚙️・Staff', '⚙️┃Staff'], name: '🛡️・Administrateur', color: 0xf97316, hoist: true, perms: [P.ManageChannels, P.ManageMessages, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ViewAuditLog, P.ManageNicknames, P.MentionEveryone] },
    { key: 'mod', name: '🔨・Modérateur', color: 0xfacc15, hoist: true, perms: [P.ManageMessages, P.ModerateMembers, P.MuteMembers, P.MoveMembers, P.ManageNicknames, P.ViewAuditLog] },
    { key: 'support', name: '🎧・Support', color: 0x38bdf8, hoist: true, perms: [P.ManageMessages, P.ModerateMembers] },
    { key: 'helper', name: '🙌・Helper', color: 0x2dd4bf, hoist: true, perms: [] },
    { key: 'sep2', name: '━━━ COMMUNAUTÉ ━━━', color: 0x3f3f46 },
    { key: 'partner', name: '🏢・Partenaire', color: 0x14b8a6, hoist: true },
    { key: 'vip', oldNames: ['★┃VIP', '⭐・VIP'], name: '⭐・VIP', color: GOLD, hoist: true },
    { key: 'top', name: '🏆・Top de la semaine', color: 0xfb923c, hoist: true },
    { key: 'creator', oldNames: ['🛠️┃Créateur'], name: '🛠️・Créateur', color: GREEN, hoist: true },
    { key: 'member', name: '👤・Membre', color: 0x9ca3af },
    { key: 'sep3', name: '━━━ NOTIFICATIONS ━━━', color: 0x3f3f46 },
    { key: 'n_news', name: '🔔・Nouveautés', color: 0x71717a, mention: true },
    { key: 'n_give', name: '🎁・Giveaways', color: 0x71717a, mention: true },
    { key: 'n_ann', name: '📢・Annonces', color: 0x71717a, mention: true }
  ];
  const STAFF_KEYS = ['founder', 'cofounder', 'manager', 'admin', 'mod', 'support'];
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
      if (i === 0) {
        const e = new EmbedBuilder().setColor(ORANGE).setDescription('Clique sur un bouton pour **recevoir** (ou arrêter de recevoir) les annonces.\n\n🔔 **Nouveautés** · 🎁 **Giveaways** · 📢 **Annonces**\nEt un rôle par **catégorie** : tu es prévenu à chaque nouvel ajout dans celles qui t\'intéressent.');
        const png = cards ? await cards.sectionBanner({ title: 'Tes notifications', subtitle: 'Choisis ce que tu veux recevoir' }).catch(() => null) : null;
        if (png) { payload.files = [new AttachmentBuilder(png, { name: 'banner.png' })]; e.setImage('attachment://banner.png'); } else e.setTitle('🎭 Tes notifications');
        payload.embeds = [e];
      }
      ids.push((await ch.send(payload)).id);
    }
    S.menus = ids; await saveS();
  }  const categoryRole = async c => {   // role de notification d'une nouvelle categorie du site
    if (c.vipOnly || !S.channels['cat:ressources']) return null;
    const g = await getGuild(); await g.roles.fetch();
    let role = S.roles['c:' + c.id] && g.roles.cache.get(S.roles['c:' + c.id]);
    if (!role) { role = await g.roles.create({ name: catRoleName(c), color: 0x52525b, mentionable: true, reason: 'Categorie du site' }); S.roles['c:' + c.id] = role.id; await saveS(); await postRoleMenu(g).catch(() => {}); }
    return role;
  };

  /* ---------------- droits des salons ---------------- */
  const WRITERS = ['founder', 'cofounder', 'manager', 'admin'];   // seuls (avec le bot) a pouvoir ecrire dans les salons en lecture seule
  /* Droits d'un salon. scope : public | vip | staff ; ro : lecture seule ; voice : salon vocal.
     Les droits sont fusionnes par role (jamais deux entrees pour le meme role). */
  function overwrites(g, scope, ro, voice) {
    const m = new Map(), ev = g.roles.everyone.id;
    const add = (id, allow = [], deny = []) => {
      if (!id) return; const e = m.get(id) || { id, allow: new Set(), deny: new Set() };
      allow.forEach(x => { e.allow.add(x); e.deny.delete(x); }); deny.forEach(x => { if (!e.allow.has(x)) e.deny.add(x); }); m.set(id, e);
    };
    const VIEW = [P.ViewChannel, P.ReadMessageHistory], VOICE = [P.ViewChannel, P.Connect, P.Speak, P.UseVAD];
    const POST = [P.SendMessages, P.SendMessagesInThreads, P.EmbedLinks, P.AttachFiles];
    const NOPOST = [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads];
    if (scope === 'public') add(ev, voice ? VOICE : VIEW, ro && !voice ? NOPOST : []);
    const HIDE = voice ? [P.ViewChannel, P.Connect] : [P.ViewChannel];   // salon invisible ET inaccessible pour tout le monde
    if (scope === 'vip') { add(ev, [], HIDE); add(S.roles.vip, voice ? VOICE : [...VIEW, ...(ro ? [] : [P.SendMessages])], ro && !voice ? NOPOST : []); }
    if (scope === 'staff') add(ev, [], HIDE);
    if (scope !== 'public') for (const k of STAFF_KEYS) add(S.roles[k], voice ? [...VOICE, P.MoveMembers] : [...VIEW, ...(ro ? [] : POST)]);   // toute l'equipe voit les zones VIP et staff
    if (ro && !voice) for (const k of WRITERS) add(S.roles[k], [...POST, P.ManageMessages]);                                                  // Fondateur..Admin publient dans les salons d'annonces
    add(client.user.id, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.ManageMessages, P.Connect]);
    return [...m.values()].map(e => ({ id: e.id, allow: [...e.allow], deny: [...e.deny] }));
  }

  /* Configuration generale du serveur : droits de base de @everyone et reglages de securite. */
  async function configureGuild(g) {
    const notes = [];
    try {
      await g.roles.everyone.setPermissions([P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.ReadMessageHistory, P.AddReactions, P.EmbedLinks, P.AttachFiles, P.UseExternalEmojis, P.Connect, P.Speak, P.UseVAD, P.ChangeNickname, P.CreatePublicThreads], 'LEGEND setup');
      notes.push('**@everyone** : peut écrire, réagir et parler en vocal, mais ni @everyone/@here ni aucune permission de gestion');
    } catch (e) { notes.push('⚠️ droits de @everyone inchangés (' + cut(e.message, 60) + ')'); }
    try {
      await g.edit({ verificationLevel: 2, explicitContentFilter: 2, defaultMessageNotifications: 1, reason: 'LEGEND setup' });
      notes.push('**Sécurité** : compte Discord vérifié et ancien de 5 min requis, contenu explicite filtré pour tous, notifications limitées aux mentions');
    } catch (e) { notes.push('⚠️ réglages de sécurité inchangés (' + cut(e.message, 60) + ')'); }
    return notes;
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

  const coverOf = async r => { if (!r.images || !r.images[0] || !readImage) return null; try { return await readImage(r.images[0]); } catch { return null; } };

  const resourceApproved = guard('annonce ressource', async r => {
    const d = await describe(r), vip = d.vipOnly, url = site('/#/r/' + r.id), catUrl = site('/#/ressources/' + encodeURIComponent(d.categoryId));
    const infos = [r.version && `v${cut(r.version, 20)}`, r.framework, r.fileSize && sizeStr(r.fileSize)].filter(Boolean).join(' · ');
    const desc = cut(r.description, 240).replace(/\s*\n\s*/g, ' ').trim();
    const cover = await coverOf(r);
    const png = cards ? await cards.resourceCard({ title: r.title, category: d.categoryName, author: r.authorName, vip, cover }).catch(e => { console.error('[bot] carte :', e.message); return null; }) : null;
    const e = new EmbedBuilder().setColor(vip ? GOLD : ORANGE)
      .setAuthor({ name: `Nouvel ajout · ${d.categoryName}`, iconURL: site('/logo.png'), url: catUrl })
      .setTitle(cut(r.title, 250)).setURL(url)
      .setDescription(desc ? `> ${desc}` : 'Une ressource a été ajoutée sur le site.')
      .addFields({ name: 'Catégorie', value: `[${d.categoryName}](${catUrl})`, inline: true }, { name: 'Accès', value: vip ? '⭐ VIP' : '🟢 Gratuit', inline: true }, { name: 'Créateur', value: cut(r.authorName, 60), inline: true })
      .setFooter({ text: vip ? 'LEGEND · zone VIP' : 'LEGEND · ressources FiveM' }).setTimestamp(r.createdAt || Date.now());
    if (infos) e.addFields({ name: 'Détails', value: infos, inline: false });
    const files = [];
    if (png) { files.push(new AttachmentBuilder(png, { name: 'card.png' })); e.setImage('attachment://card.png'); }
    else if (r.images && r.images[0]) e.setImage(site('/img/' + r.images[0]));
    const row = new ActionRowBuilder().addComponents(link(vip ? 'Voir (VIP)' : 'Voir et télécharger', url), link('Catégorie · ' + cut(d.categoryName, 40), catUrl));
    const catRole = vip ? null : await categoryRole({ id: d.categoryId, name: d.categoryName, vipOnly: false }).catch(() => null);
    const pingId = vip ? S.roles.vip : catRole && catRole.id;
    const target = (await categoryChannel({ id: d.categoryId, name: d.categoryName, vipOnly: vip }).catch(() => null)) || (await chan('announce'));
    if (target) await target.send({ content: pingId ? `<@&${pingId}>` : undefined, embeds: [e], files, components: [row], allowedMentions: { roles: pingId ? [pingId] : [] } });
    if (vip) {   // apercu public (sans lien de telechargement) pour donner envie
      const tpng = cards ? await cards.resourceCard({ title: r.title, category: d.categoryName, author: r.authorName, vip: true, cover, teaser: true }).catch(() => null) : null;
      const t = new EmbedBuilder().setColor(GOLD).setAuthor({ name: 'Nouveauté VIP', iconURL: site('/logo.png') }).setTitle(cut(r.title, 200))
        .setDescription(`Une ressource exclusive vient d'arriver dans la **zone VIP**.\nDébloque-la avec le passe VIP.`).setFooter({ text: 'Réservé aux membres VIP' }).setTimestamp();
      const tfiles = []; if (tpng) { tfiles.push(new AttachmentBuilder(tpng, { name: 'teaser.png' })); t.setImage('attachment://teaser.png'); }
      await send('vipPreview', { embeds: [t], files: tfiles, components: [new ActionRowBuilder().addComponents(link('Devenir VIP', site('/#/vip')))] });
    }
    await giveCreator(r.authorId);
    if (evaluateUser) evaluateUser(r.authorId).catch(() => {});   // badges d'activite (valable aussi quand l'approbation vient d'un bouton Discord)
  });

  const pendingNotice = guard('moderation', async r => {
    const d = await describe(r), cover = await coverOf(r);
    const png = cards ? await cards.resourceCard({ title: r.title, category: d.categoryName, author: r.authorName, vip: d.vipOnly, cover }).catch(() => null) : null;
    const e = new EmbedBuilder().setColor(GREY).setAuthor({ name: 'En attente de validation', iconURL: site('/logo.png') }).setTitle(cut(r.title, 240)).setURL(site('/#/r/' + r.id))
      .setDescription(cut(r.description, 400) || '—')
      .addFields({ name: 'Catégorie', value: d.categoryName, inline: true }, { name: 'Par', value: `${cut(r.authorName, 60)} (<@${r.authorId}>)`, inline: true }, { name: 'Taille', value: sizeStr(r.fileSize || 0), inline: true })
      .setFooter({ text: 'Valider = publier et annoncer' }).setTimestamp();
    const files = []; if (png) { files.push(new AttachmentBuilder(png, { name: 'card.png' })); e.setImage('attachment://card.png'); }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('res:approve:' + r.id).setLabel('Valider').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('res:reject:' + r.id).setLabel('Refuser').setStyle(ButtonStyle.Danger), link('Ouvrir', site('/#/r/' + r.id)));
    await send('mod', { embeds: [e], files, components: [row] });
  });  const resourceAdded = guard('ressource ajoutee', async r => (r.status === 'approved' ? resourceApproved(r) : pendingNotice(r)));

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
    if (awardBadge) await awardBadge(list[0].id, 'top', null, true);   // badge « Top de la semaine »
  });

  /* ---------------- patch notes automatiques ----------------
     Le fichier patch-notes.json decrit chaque mise a jour (la plus recente en premier).
     A chaque demarrage, le bot publie les versions plus recentes que la derniere publiee. */
  const readPatchNotes = () => { try { const a = JSON.parse(fs.readFileSync(path.join(__dirname, 'patch-notes.json'), 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } };
  const bullets = list => cut((list || []).map(x => '• ' + String(x)).join('\n'), 1024);
  async function sendPatch(entry) {
    const e = new EmbedBuilder().setColor(ORANGE).setAuthor({ name: 'Mise à jour du site', iconURL: site('/logo.png'), url: site('/') })
      .setTitle(`v${entry.version} · ${cut(entry.title, 200)}`).setURL(site('/'))
      .setFooter({ text: `LEGEND · ${entry.date || ''}`.trim() }).setTimestamp(entry.date ? new Date(entry.date + 'T12:00:00Z') : new Date());
    if (entry.summary) e.setDescription(cut(entry.summary, 400));
    if (entry.new && entry.new.length) e.addFields({ name: '✨  Nouveautés', value: bullets(entry.new) });
    if (entry.improved && entry.improved.length) e.addFields({ name: '🔧  Améliorations', value: bullets(entry.improved) });
    if (entry.fixed && entry.fixed.length) e.addFields({ name: '🐛  Corrections', value: bullets(entry.fixed) });
    const files = [], png = cards ? await cards.sectionBanner({ title: `Mise à jour ${entry.version}`, subtitle: entry.title }).catch(() => null) : null;
    if (png) { files.push(new AttachmentBuilder(png, { name: 'patch.png' })); e.setImage('attachment://patch.png'); }
    await send('patch', { embeds: [e], files, components: [new ActionRowBuilder().addComponents(link('Ouvrir le site', site('/')), link('Toutes les ressources', site('/#/ressources')))] });
  }
  const postPatchNotes = guard('patch-notes', async force => {
    const notes = readPatchNotes(); if (!notes.length || !S.channels.patch) return 0;   // pas de salon : on ne marque rien, ce sera publie apres /setup
    const last = await store.setting('patchVersion'); let todo;
    if (force || !last) todo = [notes[0]];                                           // 1er demarrage : seulement la plus recente
    else { const i = notes.findIndex(n => n.version === last); todo = (i === -1 ? [notes[0]] : notes.slice(0, i)).slice(0, 3).reverse(); }
    for (const n of todo) await sendPatch(n);
    await store.setSetting('patchVersion', notes[0].version);
    return todo.length;
  });
  const orderPaid = guard('paiement', async o => {   // journal des achats de VIP (salon staff)
    await send('logs', { embeds: [new EmbedBuilder().setColor(GREEN).setTitle('💰 Paiement reçu')
      .setDescription(`<@${o.userId}> (${cut(o.userName, 40)}) a acheté **VIP · ${cut(o.label, 30)}**\nMontant : **${Number(o.amount).toFixed(2)} ${String(o.currency).toUpperCase()}**`)
      .setFooter({ text: `Commande ${String(o.id).slice(0, 8)} · ${o.provider}` }).setTimestamp()], allowedMentions: { parse: [] } });
  });

  /* ---------------- badges ---------------- */
  const hexInt = c => parseInt(String(c || '#a1a1aa').slice(1), 16) || 0xa1a1aa;
  async function postBadgeCatalogue() {   // un message de reference (supprime puis republie), les annonces restent en dessous
    const ch = await chan('badges'); if (!ch || !badgeCatalogue) return;
    if (S.badgeMsg) { const m = await ch.messages.fetch(S.badgeMsg).catch(() => null); if (m) await m.delete().catch(() => {}); }
    const list = await badgeCatalogue(), special = list.filter(b => !b.auto), auto = list.filter(b => b.auto);
    const fmt = b => `${b.emoji} **${cut(b.name, 40)}** — ${cut(b.description, 100)}`;
    const e = new EmbedBuilder().setColor(ORANGE).setDescription('Les badges se débloquent selon ton activité sur le site, ou sont remis par l\'équipe. Ils s\'affichent sur ton **profil** et dans le **classement**.')
      .addFields({ name: '🎖️  À débloquer', value: cut(auto.map(fmt).join('\n'), 1024) || '—' }, ...(special.length ? [{ name: '✨  Badges spéciaux', value: cut(special.map(fmt).join('\n'), 1024) }] : []));
    const files = [], png = cards ? await cards.sectionBanner({ title: 'Badges', subtitle: 'Collectionne-les tous' }).catch(() => null) : null;
    if (png) { files.push(new AttachmentBuilder(png, { name: 'badges.png' })); e.setImage('attachment://badges.png'); } else e.setTitle('🏅 Badges');
    const m = await ch.send({ embeds: [e], files, components: [new ActionRowBuilder().addComponents(link('Voir tous les badges', site('/#/badges')))] });
    S.badgeMsg = m.id; await saveS();
  }
  const badgesChanged = guard('badges', async () => { if (ready) await postBadgeCatalogue(); });
  const badgeAwarded = guard('badge obtenu', async (uid, b) => {
    const g = await getGuild(), m = await g.members.fetch(uid).catch(() => null), u = !m && ctx.userName ? await ctx.userName(uid) : null;
    const who = m ? `<@${uid}>` : `**${cut(u || 'Un membre', 40)}**`;
    const e = new EmbedBuilder().setColor(hexInt(b.color)).setAuthor({ name: 'Nouveau badge', iconURL: site('/logo.png') })
      .setTitle(`${b.emoji}  ${b.name}`).setDescription(`${who} vient de débloquer un badge !\n\n> ${cut(b.description, 150)}`).setFooter({ text: 'LEGEND · badges' }).setTimestamp();
    await send('badges', { embeds: [e], components: [new ActionRowBuilder().addComponents(link('Voir le profil', site('/#/membre/' + uid)))], allowedMentions: { users: m ? [uid] : [] } });
  });
  async function badgesCommand(i) {    // /badges [membre] : tout le monde peut l'utiliser
    await i.deferReply();
    const u = i.options.getUser('membre') || i.user, list = memberBadges ? await memberBadges(u.id) : [], st = statsOf ? await statsOf(u.id) : { resources: 0, downloads: 0 };
    const icon = u.displayAvatarURL ? u.displayAvatarURL({ extension: 'png', size: 128 }) : '';
    const e = new EmbedBuilder().setColor(ORANGE).setAuthor({ name: u.globalName || u.username, iconURL: /^https?:\/\//.test(icon || '') ? icon : undefined, url: site('/#/membre/' + u.id) })
      .setTitle(list.length ? `🏅 ${list.length} badge${list.length > 1 ? 's' : ''}` : '🏅 Aucun badge pour le moment')
      .setDescription(list.length ? list.map(b => `${b.emoji} **${cut(b.name, 40)}** — ${cut(b.description, 100)}`).join('\n') : 'Publie des ressources et fais-toi télécharger pour en débloquer.')
      .addFields({ name: 'Ressources', value: String(st.resources), inline: true }, { name: 'Téléchargements', value: String(st.downloads), inline: true });
    return i.editReply({ embeds: [e], components: [new ActionRowBuilder().addComponents(link('Voir le profil', site('/#/membre/' + u.id)))] });
  }

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
      { key: 'patch', e: '🗒️', n: 'patch-notes', ro: true, topic: 'Les mises à jour du site.' },
      { key: 'badges', e: '🏅', n: 'badges', ro: true, topic: 'Les badges du site et ceux que la communauté débloque.' }] },
    { key: 'ressources', name: 'RESSOURCES', scope: 'public', cats: 'public', ch: [
      { key: 'requests', e: '🛠️', n: 'demandes', slow: 30, topic: 'Demande une ressource à la communauté.' }] },
    { key: 'accesVip', name: 'ACCÈS VIP', scope: 'public', ch: [
      { key: 'vipInfo', e: '⭐', n: 'devenir-vip', ro: true, topic: 'Comment obtenir le VIP.' },
      { key: 'vipPreview', e: '👀', n: 'aperçu-vip', ro: true, topic: 'Aperçu des ressources exclusives VIP.' }] },
    { key: 'vip', name: 'ZONE VIP', scope: 'vip', cats: 'vip', ch: [
      { key: 'vipChat', e: '💬', n: 'chat-vip', topic: 'Le salon des membres VIP.' }] },
    { key: 'community', name: 'COMMUNAUTÉ', scope: 'public', ch: [
      { key: 'chat', e: '💬', n: 'discussion', slow: 3, topic: 'Discussion générale.' },
      { key: 'media', e: '📸', n: 'médias', slow: 10, topic: 'Captures, clips et créations.' },
      { key: 'suggestions', e: '💡', n: 'suggestions', slow: 60, topic: 'Une idée pour le site ou le serveur ? Dis-le ici.' }] },
    { key: 'support', name: 'SUPPORT', scope: 'public', ch: [
      { key: 'support', e: '🆘', n: 'support', slow: 15, topic: 'Besoin d\'aide ? Pose ta question.' }] },
    { key: 'staff', name: 'STAFF', scope: 'staff', ch: [
      { key: 'mod', e: '🛡️', n: 'modération', topic: 'Validation des ressources et signalements.' },
      { key: 'logs', e: '🧾', n: 'logs', topic: 'Journal : VIP, actions du bot.' },
      { key: 'botCmd', e: '🤖', n: 'commandes-bot', topic: '/setup, /nettoyer, /vip donner, /vip retirer, /vip statut' }],
      voice: [{ key: 'vcStaff', e: '🛡️', n: 'Réunion staff' }] },
    { key: 'voice', name: 'VOCAUX', scope: 'public', voice: [
      { key: 'vc1', e: '🔊', n: 'Général' }, { key: 'vc2', e: '🎧', n: 'Détente' }, { key: 'vcVip', e: '⭐', n: 'Salon VIP', scope: 'vip' }] }
  ];
  const LEGACY = ['newRes', 'vipNews'];

  async function setupGuild(g, progress) {
    const made = [], kept = [];
    await g.channels.fetch();
    const siteCats = await categories();
    await ensureRoles(g, siteCats, made, kept);
    const config = await configureGuild(g);
    await progress('Rôles et réglages prêts. Création des salons…');
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
      for (const d of c.ch || []) await ensure(d.key, chName(d.e, d.n), ChannelType.GuildText, cat.id, { topic: d.topic, rateLimitPerUser: d.slow || 0 }, overwrites(g, c.scope, !!d.ro, false));
      for (const d of c.voice || []) await ensure(d.key, chName(d.e, d.n), ChannelType.GuildVoice, cat.id, {}, overwrites(g, d.scope || c.scope, false, true));
      if (c.cats) for (const sc of siteCats.filter(x => (c.cats === 'vip') === !!x.vipOnly)) {
        const before = !!S.channels['rc:' + sc.id]; const ch = await categoryChannel(sc);
        if (ch) (before ? kept : made).push(ch.name);
      }
      await progress(`Section « ${catTitle(c.name)} » prête.`);
    }
    // les admins du site : le premier est Fondateur, le second Co-Fondateur
    for (const [idx, uid] of [...admins].entries()) {
      const role = g.roles.cache.get(S.roles[idx === 0 ? 'founder' : 'cofounder']), m = await g.members.fetch(uid).catch(() => null);
      if (m && role && !m.roles.cache.has(role.id)) await m.roles.add(role, 'Admin du site').catch(() => {});
    }
    // salons d'information : entete illustree, republiee a chaque /setup (les anciens messages du bot sont supprimes)
    const post = async (key, banner, embed, components) => {
      const ch = await chan(key); if (!ch) return;
      const old = await ch.messages.fetch({ limit: 30 }).catch(() => null);
      if (old && old.values) for (const m of old.values()) if (m.author && m.author.id === client.user.id) await m.delete().catch(() => {});
      const files = [], png = cards ? await cards.sectionBanner(banner).catch(() => null) : null;
      if (png) { files.push(new AttachmentBuilder(png, { name: 'banner.png' })); embed.setImage('attachment://banner.png'); } else embed.setTitle(banner.title);
      await ch.send({ embeds: [embed], files, components: components || [] });
    };
    const GOLD_HEX = '#f5b942';
    await post('rules', { title: 'Règlement', subtitle: 'À lire avant de participer au serveur' }, new EmbedBuilder().setColor(ORANGE).setDescription([
      '**1️⃣  Respect**\nPas d\'insultes, de harcèlement ni de discrimination. On reste courtois.',
      '**2️⃣  Pas de spam**\nPas de publicité, de pub en MP ni de liens douteux.',
      '**3️⃣  Contenus légaux**\nPartage uniquement ce dont tu es l\'auteur ou dont la licence l\'autorise. Les scripts payants piratés ou volés sont **interdits**.',
      '**4️⃣  Le staff a raison**\nSi tu as un souci, ouvre un ticket dans le support au lieu de débattre en public.',
      '**5️⃣  Signaler**\nUn contenu pose problème ? Utilise le bouton « Signaler » sur le site.'].join('\n\n')).setFooter({ text: 'En restant sur ce serveur, tu acceptes ces règles.' }));
    await post('info', { title: 'Informations', subtitle: 'Tout savoir sur LEGEND' }, new EmbedBuilder().setColor(ORANGE).setDescription([
      '### 📦  Ressources',
      'Une **catégorie = un salon** : chaque nouvel ajout est annoncé dans la section **RESSOURCES**.',
      '### 🔔  Notifications',
      'Choisis ce que tu veux recevoir dans <#' + (S.channels.roles || '') + '>.',
      '### 🏆  Classement',
      'Les créateurs les plus téléchargés sont mis en avant chaque lundi.',
      '### ⭐  Passe VIP',
      'Accède à la zone VIP et aux ressources exclusives.',
      '### 🛠️  Outils gratuits',
      'Écran de chargement FiveM et bannières Discord animées, sur le site.'].join('\n')));
    await post('site', { title: 'Site officiel', subtitle: 'Ressources, classement et outils' }, new EmbedBuilder().setColor(ORANGE).setDescription('Toutes les ressources, le classement des créateurs et les outils gratuits sont sur le site.'),
      [new ActionRowBuilder().addComponents(link('Ouvrir le site', site('/')), link('Ressources', site('/#/ressources')), link('Classement', site('/#/classement')), link('Outils', site('/#/tools/banner')))]);
    await post('vipInfo', { title: 'Passe VIP', subtitle: 'Accès exclusif', accent: GOLD_HEX }, new EmbedBuilder().setColor(GOLD).setDescription([
      'Le VIP ouvre la **zone VIP** :',
      '• des **ressources exclusives**',
      '• un **salon privé**',
      '• les **modèles premium** des outils',
      '',
      'Il est attribué par l\'équipe, pour une durée limitée ou à vie, et s\'arrête automatiquement à la fin de la période.',
      '',
      'Un aperçu des dernières nouveautés est dans <#' + (S.channels.vipPreview || '') + '>.'].join('\n')),
      [new ActionRowBuilder().addComponents(link('Découvrir le VIP', site('/#/vip')))]);
    await postBadgeCatalogue().catch(e => console.error('[bot] badges :', e.message));
    await postRoleMenu(g);
    for (const k of LEGEND_REMOVE()) delete S.channels[k];
    await saveS();
    await postPatchNotes();
    return { made, kept, config };
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
    new SlashCommandBuilder().setName('badges').setDescription('Voir les badges d\'un membre').setDMPermission(false)
      .addUserOption(o => o.setName('membre').setDescription('Le membre (toi par défaut)')),
    new SlashCommandBuilder().setName('patchnotes').setDescription('Republie la dernière mise à jour dans le salon patch-notes').setDefaultMemberPermissions(P.Administrator).setDMPermission(false),
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
        if (i.commandName === 'badges') return badgesCommand(i);   // ouvert a tous les membres
        if (!admins.has(i.user.id)) return i.reply({ content: 'Réservé aux admins du site.', flags: EPHEMERAL });
        if (i.commandName === 'setup') {
          await i.deferReply({ flags: EPHEMERAL });
          try {
            const r = await setupGuild(i.guild, msg => i.editReply(msg).catch(() => {}));
            const first = Object.keys(S.channels).find(k => k.startsWith('rc:'));
            const summary = `✅ **Serveur prêt.**\nCréé : ${r.made.length ? r.made.slice(0, 30).map(x => '`' + x + '`').join(', ') : 'rien de nouveau'}${r.made.length > 30 ? '…' : ''}\nDéjà en place : ${r.kept.length} élément(s) mis à jour.\nChaque nouvel ajout est annoncé dans le salon de sa catégorie${first ? ` (ex : <#${S.channels[first]}>)` : ''} ; choisis tes notifications dans <#${S.channels.roles}>.\n\n🔒 **Configuration appliquée**\n${r.config.map(x => '• ' + x).join('\n')}\n• **Salons d'annonces** (règlement, annonces, ressources…) : lecture seule pour les membres, seuls Fondateur, Co-Fondateur, Responsable et Administrateur (et le bot) peuvent y écrire\n• **Zones VIP et STAFF** : invisibles pour les autres, **modes lents** sur les salons de discussion`;
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
        if (i.commandName === 'patchnotes') {
          await i.deferReply({ flags: EPHEMERAL });
          if (!S.channels.patch) return i.editReply('Lance d\'abord `/setup` : le salon patch-notes n\'existe pas encore.');
          const n = await postPatchNotes(true);
          return i.editReply(n ? `✅ Dernière mise à jour republiée dans <#${S.channels.patch}>.` : 'Aucune mise à jour trouvée dans patch-notes.json.');
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
      setInterval(weekly, 30 * 60 * 1000).unref(); weekly(); postPatchNotes();
    } catch (e) { console.error('[bot] demarrage :', e.message, '— le bot est-il bien invite sur le serveur ?'); }
  });
  client.on(Events.Error, e => console.error('[bot]', e.message));
  client.login(token).catch(e => console.error('[bot] connexion impossible :', e.message));

  const invite = clientId ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=8` : null;
  return {
    enabled: true, resourceAdded, resourceApproved, reportAdded, vipChanged, badgeAwarded, badgesChanged, orderPaid,
    status: async () => ({ enabled: true, ready, tag: client.user && client.user.tag, guild: ready ? (await getGuild()).name : null, setupDone: !!S.channels['cat:ressources'], channels: S.channels, roles: S.roles, invite })
  };
};

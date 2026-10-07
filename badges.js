/* Badges automatiques : attribues par le site selon l'activite d'un membre.
   Les badges "speciaux" (Fondateur, Partenaire…) sont geres a la main par les admins (table badges). */
const AUTO = [
  { id: 'top', emoji: '🏆', name: 'Top de la semaine', description: 'Premier du classement hebdomadaire des créateurs', color: '#fb923c' },   // donne par le bot chaque lundi
  { id: 'legend', emoji: '💎', name: 'Légende', description: '10 000 téléchargements sur tes ressources', color: '#22d3ee', test: s => s.downloads >= 10000 },
  { id: 'star', emoji: '🔥', name: 'Star', description: '1 000 téléchargements sur tes ressources', color: '#f97316', test: s => s.downloads >= 1000 },
  { id: 'prolific', emoji: '🏭', name: 'Prolifique', description: '25 ressources validées', color: '#a78bfa', test: s => s.resources >= 25 },
  { id: 'popular', emoji: '📥', name: 'Populaire', description: '100 téléchargements sur tes ressources', color: '#f59e0b', test: s => s.downloads >= 100 },
  { id: 'contrib', emoji: '📦', name: 'Contributeur', description: '5 ressources validées', color: '#38bdf8', test: s => s.resources >= 5 },
  { id: 'veteran', emoji: '🗓️', name: 'Ancien', description: 'Membre depuis plus de 90 jours', color: '#94a3b8', test: s => s.days >= 90 },
  { id: 'first', emoji: '🌱', name: 'Premier pas', description: 'Ta première ressource validée', color: '#4ade80', test: s => s.resources >= 1 }
].map(b => ({ ...b, auto: true }));

const AUTO_BY_ID = new Map(AUTO.map(b => [b.id, b]));
const AUTO_ORDER = AUTO.map(b => b.id);   // ordre d'importance (affichage)

/* Fusionne definitions auto + speciales, dans l'ordre d'affichage : speciaux d'abord, puis auto par importance. */
function catalogue(manual) {
  return [...manual.map(b => ({ ...b, auto: false })), ...AUTO];
}
function sortForDisplay(ids, manual) {
  const mIdx = new Map(manual.map((b, i) => [b.id, i]));
  const rank = id => (mIdx.has(id) ? mIdx.get(id) : 1000 + AUTO_ORDER.indexOf(id));
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

module.exports = { AUTO, AUTO_BY_ID, AUTO_ORDER, catalogue, sortForDisplay };

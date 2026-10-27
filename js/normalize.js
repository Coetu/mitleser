// Mitleser – Sprachaufbereitung (Deutsch)
//
// Hier steht alles, was aus geschriebenem Text eine "Sprechform" macht und was Wörter vergleichbar macht:
//   spokenForms("2026")  -> ["zweitausendsechsundzwanzig", ...]   (wie man das Token ausspricht)
//   phoneticKey("Wälzlager") -> "velzlaker"                        (grober Lautschlüssel für den Vergleich)
// Sprechformen sind klein geschrieben und ohne Leerzeichen, weil die Erkennung zusammengesetzte Wörter
// mal getrennt ("kegel rollen lager"), mal zusammen liefert. Der Abgleich vergleicht deshalb Buchstabenketten.

const ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
  'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

// ---------------------------------------------------------------------------------------------------------
// Zahlwörter

/** Zahlwort für 0 … 999 999 999 999 (Grundform, z. B. 2026 -> "zweitausendsechsundzwanzig"). */
export function numberToWords(n, { compound = false } = {}) {
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n || n >= 1e12) return '';
  if (n === 0) return 'null';
  if (n === 1) return compound ? 'ein' : 'eins';
  const s = below1e12(n);
  return compound ? s : s.replace(/ein$/, n % 100 === 1 ? 'eins' : 'ein');
}

function below100(n) {
  if (n < 20) return n === 1 ? 'ein' : ONES[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? TENS[t] : (u === 1 ? 'ein' : ONES[u]) + 'und' + TENS[t];
}

/** 1 … 999; eine 1 am Ende bleibt "ein" (wird bei Bedarf zu "eins" ergänzt). */
function below1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let s = h ? (h === 1 ? 'ein' : ONES[h]) + 'hundert' : '';
  if (r) s += below100(r);
  return s;
}

function below1e6(n) {
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  let s = th ? below1000(th) + 'tausend' : '';
  if (r) s += below1000(r);
  return s;
}

function below1e12(n) {
  if (n < 1e6) return below1e6(n);
  const bill = Math.floor(n / 1e9);
  const mill = Math.floor((n % 1e9) / 1e6);
  const rest = n % 1e6;
  let s = '';
  if (bill) s += bill === 1 ? 'einemilliarde' : below1e6(bill) + 'milliarden';
  if (mill) s += mill === 1 ? 'einemillion' : below1e6(mill) + 'millionen';
  if (rest) s += below1e6(rest);
  return s;
}

/** Verschiedene übliche Aussprachen einer ganzen Zahl. */
export function cardinalForms(n) {
  const forms = new Set();
  const base = numberToWords(n);
  if (!base) return [];
  forms.add(base);
  // "einhundert…"/"eintausend…" werden oft ohne "ein" gesprochen.
  if (/^ein(hundert|tausend)/.test(base)) forms.add(base.replace(/^ein/, ''));
  if (base.includes('eintausend')) forms.add(base.replace('eintausend', 'tausend'));
  // Jahreszahlen und Hunderter-Lesart: 1984 -> "neunzehnhundertvierundachtzig", 1500 -> "fünfzehnhundert".
  if (n >= 1100 && n <= 9999 && Math.floor(n / 100) % 10 !== 0) {
    const hi = Math.floor(n / 100);
    const lo = n % 100;
    forms.add(below100(hi) + 'hundert' + (lo ? (lo === 1 ? 'eins' : below100(lo)) : ''));
  }
  // Ziffernweise (Bestellnummern, Typenbezeichnungen): 6205 -> "sechszweinullfünf".
  const digits = String(n);
  if (digits.length >= 3) forms.add(digitsToWords(digits));
  // Paarweise bei vierstelligen Nummern: 6205 -> "zweiundsechzignullfünf".
  if (digits.length === 4 && !(n >= 1100 && n <= 2099)) {
    const a = Number(digits.slice(0, 2));
    const b = digits.slice(2);
    forms.add(numberToWords(a) + (b[0] === '0' ? 'null' + ONES[Number(b[1])] : numberToWords(Number(b))));
  }
  return [...forms];
}

/** Ziffern einzeln: "0421" -> "nullviereinszwei". */
export function digitsToWords(digits) {
  return [...String(digits)].filter((d) => /\d/.test(d)).map((d) => (d === '1' ? 'eins' : ONES[Number(d)])).join('');
}

/** Ganze Zahl als Text, auch mit führenden Nullen oder sehr groß. */
function integerForms(digits) {
  if (/^0\d/.test(digits) || digits.length > 12) return [digitsToWords(digits)];
  return cardinalForms(Number(digits));
}

const ORDINAL_STEMS = { 1: 'erst', 3: 'dritt', 7: 'siebt', 8: 'acht' };
const ORDINAL_ENDINGS = ['e', 'en', 'er', 'es', 'em'];

/** Ordnungszahl: 3 -> ["dritte", "dritten", ...]. */
export function ordinalForms(n) {
  if (!Number.isFinite(n) || n < 1 || n > 1e6) return [];
  let stem;
  if (ORDINAL_STEMS[n]) stem = ORDINAL_STEMS[n];
  else if (n < 20) stem = numberToWords(n) + 't';
  else {
    const r = n % 100;
    if (r !== 0 && r < 20) {
      const head = numberToWords(n - r, { compound: true });
      stem = head + (ORDINAL_STEMS[r] || numberToWords(r) + 't');
    } else stem = numberToWords(n, { compound: true }) + 'st';
  }
  return ORDINAL_ENDINGS.map((e) => stem + e);
}

/** Nenner eines Bruchs: 2 -> "halb", 4 -> "viertel", 7 -> "siebtel", 20 -> "zwanzigstel". */
function fractionWord(d) {
  if (d === 2) return 'halb';
  if (d === 3) return 'drittel';
  if (d === 7) return 'siebtel';
  if (d === 8) return 'achtel';
  if (d >= 4 && d < 20) return numberToWords(d) + 'tel';
  if (d >= 20 && d <= 1000) return numberToWords(d, { compound: true }) + 'stel';
  return '';
}

/** Dezimalzahl: ("3", "5") -> ["dreikommafünf", "dreieinhalb"], ("0", "05") -> ["nullkommanullfünf"]. */
function decimalForms(intPart, fracPart, sep = 'komma') {
  const n = Number(intPart);
  const ints = integerForms(intPart).slice(0, 2);
  const fracs = new Set([digitsToWords(fracPart)]);
  if (fracPart.length === 2 && fracPart[0] !== '0') fracs.add(numberToWords(Number(fracPart)));
  const out = [];
  for (const h of ints) for (const f of fracs) out.push(h + sep + f);
  if (sep !== 'komma') return out;
  // Umgangssprachlich: 2,5 -> "zweieinhalb", 1,5 -> "eineinhalb"/"anderthalb", 0,5 -> "einhalb"/"halb".
  const whole = n === 0 ? '' : n === 1 ? 'ein' : numberToWords(n, { compound: true });
  const frac = fracPart.replace(/0+$/, '');
  if (frac === '5') {
    if (n === 0) out.push('einhalb', 'halb', 'einenhalben', 'eine halbe'.replace(' ', ''));
    else out.push(whole + 'einhalb');
    if (n === 1) out.push('anderthalb');
  } else if (frac === '25') out.push(whole + 'einviertel');
  else if (frac === '75') out.push(whole + 'dreiviertel');
  return out;
}

const UNICODE_FRACTIONS = { '½': [1, 2], '⅓': [1, 3], '⅔': [2, 3], '¼': [1, 4], '¾': [3, 4], '⅕': [1, 5], '⅛': [1, 8] };

function vulgarFractionForms(whole, num, den) {
  const out = [];
  const head = whole === '' ? '' : Number(whole) === 1 ? 'ein' : numberToWords(Number(whole), { compound: true });
  const word = fractionWord(den);
  if (!word) return out;
  const numWord = num === 1 ? 'ein' : numberToWords(num);
  out.push(head + numWord + word);
  if (num === 1 && den === 2) {
    if (whole === '') out.push('halb', 'einhalb');
    if (Number(whole) === 1) out.push('anderthalb');
  }
  if (num === 1 && whole === '') out.push(word); // "viertel"
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Einheiten, Zeichen und Abkürzungen

// Groß-/Kleinschreibung zählt: "m" Meter, "M" ist keine Einheit.
const UNITS = {
  'kN': ['kilonewton'], 'N': ['newton', 'en'], 'Nm': ['newtonmeter'], 'kNm': ['kilonewtonmeter'], 'MN': ['meganewton'],
  'W': ['watt', 'we'], 'kW': ['kilowatt'], 'MW': ['megawatt'], 'GW': ['gigawatt'],
  'Wh': ['wattstunden', 'wattstunde'], 'kWh': ['kilowattstunden', 'kilowattstunde'], 'MWh': ['megawattstunden'], 'GWh': ['gigawattstunden'],
  'V': ['volt', 'fau'], 'kV': ['kilovolt'], 'mV': ['millivolt'], 'A': ['ampere', 'a'], 'mA': ['milliampere'],
  'Ah': ['amperestunden'], 'mAh': ['milliamperestunden'], 'Ω': ['ohm'], 'kΩ': ['kiloohm'],
  'Hz': ['hertz'], 'kHz': ['kilohertz'], 'MHz': ['megahertz'], 'GHz': ['gigahertz'],
  'mm': ['millimeter'], 'cm': ['zentimeter'], 'dm': ['dezimeter'], 'm': ['meter', 'em'], 'km': ['kilometer'],
  'µm': ['mikrometer', 'my'], 'μm': ['mikrometer', 'my'], 'nm': ['nanometer'],
  'qm': ['quadratmeter'], 'cbm': ['kubikmeter'], 'ha': ['hektar'],
  'g': ['gramm', 'ge'], 'kg': ['kilogramm', 'kilo'], 't': ['tonnen', 'tonne', 'te'], 'mg': ['milligramm'],
  'l': ['liter', 'el'], 'ml': ['milliliter'], 'hl': ['hektoliter'],
  'h': ['stunden', 'stunde', 'ha'], 'min': ['minuten', 'minute'], 's': ['sekunden', 'sekunde', 'es'], 'ms': ['millisekunden'],
  'Pa': ['pascal'], 'kPa': ['kilopascal'], 'MPa': ['megapascal'], 'GPa': ['gigapascal'], 'bar': ['bar'], 'mbar': ['millibar'],
  'dB': ['dezibel'], 'K': ['kelvin', 'ka'], 'lm': ['lumen'], 'lx': ['lux'],
  'kcal': ['kilokalorien'], 'cal': ['kalorien'], 'ct': ['cent'], 'ppm': ['ppm', 'pepeem'],
  'kB': ['kilobyte'], 'KB': ['kilobyte'], 'MB': ['megabyte'], 'GB': ['gigabyte'], 'TB': ['terabyte'],
  'Mbit': ['megabit'], 'Gbit': ['gigabit'], 'px': ['pixel'], 'dpi': ['dpi', 'depeie'], 'fps': ['bilderprosekunde'],
  'U/min': ['umdrehungenprominute'], 'km/h': ['kilometerprostunde', 'stundenkilometer'], 'rpm': ['umdrehungenprominute'],
  '°C': ['gradcelsius', 'grad'], '°F': ['gradfahrenheit'], '°': ['grad'], '%': ['prozent'], '‰': ['promille'],
  '€': ['euro'], 'EUR': ['euro'], '$': ['dollar'], 'USD': ['dollar'], '£': ['pfund'], 'CHF': ['franken'],
  '&': ['und'], '+': ['plus'], '=': ['gleich', 'istgleich'], '±': ['plusminus'], '×': ['mal'],
  '<': ['kleiner', 'kleineral'], '>': ['größer', 'größeral'], '≈': ['ungefähr', 'circa'], '~': ['circa', 'ungefähr'],
  '§': ['paragraf', 'paragraph'], '§§': ['paragrafen'], '#': ['nummer'], '@': ['at'], '→': [], '–': [], '—': [],
};

// Einheit im Nenner ("pro Stunde"): Einzahl
const PER_UNIT = {
  h: ['stunde'], min: ['minute'], s: ['sekunde'], a: ['jahr'], d: ['tag'], m: ['meter'], mm: ['millimeter'],
  km: ['kilometer'], kg: ['kilogramm', 'kilo'], l: ['liter'], t: ['tonne'], Monat: ['monat'], Jahr: ['jahr'],
};

const LENGTH_UNITS = { mm: 'millimeter', cm: 'zentimeter', dm: 'dezimeter', m: 'meter', km: 'kilometer', µm: 'mikrometer', μm: 'mikrometer' };

/** Sprechformen einer Einheit, auch zusammengesetzt ("m³/h", "N/mm²", "km²", "m2"). null = keine Einheit. */
function unitForms(text) {
  if (!text) return null;
  if (UNITS[text]) {
    // Kurze Einheiten werden manchmal buchstabiert ("kN" -> "ka en").
    const spelled = /^[A-Za-z]{2,3}$/.test(text) && text !== 'bar' ? [spellLetters(text)] : [];
    return uniq([...UNITS[text], ...spelled]);
  }
  const power = /^(mm|cm|dm|m|km|µm|μm)([²³23])$/.exec(text);
  if (power) return [(/[²2]/.test(power[2]) ? 'quadrat' : 'kubik') + LENGTH_UNITS[power[1]]];
  const slash = /^([^/]+)\/([^/]+)$/.exec(text);
  if (slash) {
    const top = unitForms(slash[1]);
    const bottom = PER_UNIT[slash[2]] || unitForms(slash[2]);
    if (top && top.length && bottom && bottom.length) {
      const out = [];
      for (const a of top.slice(0, 2)) for (const b of bottom.slice(0, 2)) out.push(a + 'pro' + b);
      return out;
    }
  }
  return null;
}

// Abkürzungen mit Punkt (klein geschrieben nachschlagen). Mehrteilige ("z. B.") stehen auch als einzelne Teile drin.
const ABBREVIATIONS = {
  'bzw.': ['beziehungsweise'], 'usw.': ['undsoweiter'], 'ca.': ['circa', 'zirka'], 'etc.': ['etcetera'],
  'nr.': ['nummer'], 'dr.': ['doktor'], 'prof.': ['professor'], 'evtl.': ['eventuell'], 'ggf.': ['gegebenenfalls'],
  'inkl.': ['inklusive'], 'exkl.': ['exklusive'], 'einschl.': ['einschließlich'], 'zzgl.': ['zuzüglich'],
  'bzgl.': ['bezüglich'], 'ggü.': ['gegenüber'], 'mwst.': ['mehrwertsteuer'], 'vs.': ['versus', 'gegen'],
  'max.': ['maximal', 'maximum', 'maximale'], 'min.': ['mindestens', 'minimal', 'minimum', 'minuten'],
  'mind.': ['mindestens'], 'vgl.': ['vergleiche'], 'abb.': ['abbildung'], 'kap.': ['kapitel'], 'tab.': ['tabelle'],
  'abs.': ['absatz'], 'art.': ['artikel'], 'ff.': ['folgende'], 'f.': ['folgende'], 'tel.': ['telefon'], 'fa.': ['firma'],
  'abt.': ['abteilung'], 'bsp.': ['beispiel'], 'pkt.': ['punkt'], 'sek.': ['sekunden'], 'mo.': ['montag'], 'di.': ['dienstag'],
  'mi.': ['mittwoch'], 'do.': ['donnerstag'], 'sa.': ['samstag'], 'so.': ['sonntag'],
  's.': ['seite', 'siehe'], 'st.': ['stück', 'sankt'], 'stk.': ['stück'], 'std.': ['stunden', 'stunde'], 'mio.': ['millionen', 'million'],
  'mrd.': ['milliarden', 'milliarde'], 'tsd.': ['tausend'], 'bspw.': ['beispielsweise'], 'insb.': ['insbesondere'],
  'sog.': ['sogenannte', 'sogenannten', 'sogenannter'], 'allg.': ['allgemein'], 'jh.': ['jahrhundert'], 'jhd.': ['jahrhundert'],
  'z.': ['zum', 'zur'], 'b.': ['beispiel'], 'd.': ['das', 'der'], 'h.': ['heißt'], 'u.': ['und', 'unter'], 'a.': ['anderem', 'andere'],
  'v.': ['vor', 'von'], 'chr.': ['christus'], 'i.': ['im', 'in'], 'r.': ['regel'], 'o.': ['oder', 'oben'], 'ä.': ['ähnliches'],
  't.': ['teil'], 'e.': ['erachtens'], 'gmbh': ['gmbh', 'gehembeha'], 'co.': ['co', 'kompanie'], 'kg.': ['kg', 'kage', 'kilogramm'],
  'mr.': ['mister'], 'mrs.': ['misses'], 'jan.': ['januar'], 'feb.': ['februar'], 'aug.': ['august'], 'sept.': ['september'],
  'okt.': ['oktober'], 'nov.': ['november'], 'dez.': ['dezember'], 'hr.': ['herr'], 'fr.': ['frau', 'freitag'], 'str.': ['straße'],
};

// Mehrteilige Abkürzungen, nachgeschlagen ohne Punkte und Leerzeichen ("z.B.", "z. B.", "i.d.R.")
const MULTI_ABBREVIATIONS = {
  zb: ['zumbeispiel'], dh: ['dasheißt'], ua: ['unteranderem', 'undandere'], oä: ['oderähnliches'], idr: ['inderregel'],
  va: ['vorallem'], zt: ['zumteil'], uu: ['unterumständen'], so: ['sieheoben'], su: ['sieheunten'], uvm: ['undvielesmehr'],
  me: ['meineserachtens'], ia: ['imallgemeinen', 'imauftrag'], zz: ['zurzeit'], zzt: ['zurzeit'], vchr: ['vorchristus'],
  nchr: ['nachchristus'], ggfs: ['gegebenenfalls'], ust: ['umsatzsteuer'], ustid: ['umsatzsteuerid'],
};

// Abkürzungen, die oft ganz ohne Punkt geschrieben werden (und keine normalen Wörter sind)
const BARE_ABBREVIATIONS = {
  usw: ['undsoweiter'], bzw: ['beziehungsweise'], ca: ['circa', 'zirka'], etc: ['etcetera'], ggf: ['gegebenenfalls'],
  inkl: ['inklusive'], evtl: ['eventuell'], bspw: ['beispielsweise'], bzgl: ['bezüglich'], zzgl: ['zuzüglich'],
  mwst: ['mehrwertsteuer'], mio: ['millionen', 'million'], mrd: ['milliarden', 'milliarde'], zb: ['zumbeispiel'],
  usa: ['usa', 'uesa'],
};

// Englische Lehnwörter, so wie die deutsche Erkennung sie meist schreibt
const LOANWORDS = {
  team: ['tim', 'tiem'], teams: ['tims'], update: ['apdeit', 'abdeit'], updates: ['apdeits'], service: ['sörwis', 'sörvis', 'servis'],
  design: ['disain', 'disein'], business: ['bisnis'], feedback: ['fidbeck', 'fiedbeck'], workflow: ['wörkflou', 'workflou'],
  knowhow: ['nouhau', 'nohau'], meeting: ['mieting', 'miting'], meetings: ['mietings', 'mitings'], software: ['softwer', 'softwär'],
  hardware: ['hardwer', 'hardwär'], laptop: ['läptop', 'leptop'], computer: ['kompjuter', 'kompjuta'], online: ['onlain'],
  offline: ['oflain'], download: ['daunlod', 'daunloud'], upload: ['aploud', 'aplod'], cloud: ['klaud'], app: ['äpp', 'äp'],
  apps: ['äpps', 'äps'], manager: ['mänätscher', 'menetscher'], management: ['mänätschment', 'menetschment'], sales: ['seils'],
  customer: ['kastomer'], support: ['sapport'], deadline: ['dedlain'], highlight: ['hailait'], highlights: ['hailaits'],
  keynote: ['kinout'], kickoff: ['kickof'], roadmap: ['roudmäp'], startup: ['startap'], startups: ['startaps'], user: ['juser'],
  interface: ['interfeis'], feature: ['fitscher'], features: ['fitschers'], release: ['rilis'], tool: ['tul'], tools: ['tuls'],
  chat: ['tschät'], email: ['imeil'], mail: ['meil'], mails: ['meils'], smartphone: ['smartfoun'], workshop: ['wörkschop'],
  coach: ['koutsch'], coaching: ['koutsching'], performance: ['pörformens'], research: ['risörtsch'], device: ['diwais'],
  browser: ['brauser'], server: ['sörwer'], website: ['webseit'], homepage: ['houmpeitsch'], power: ['pauer'],
  powerpoint: ['pauerpoint'], slide: ['slaid'], slides: ['slaids'], lean: ['lien'], agile: ['ädschail'], scrum: ['skram'],
  backlog: ['bäcklog'], data: ['deita', 'data'], learning: ['lörning'], machine: ['maschin'], touch: ['tatsch'],
  screen: ['skrin'], display: ['displei'], tablet: ['täblet'], ipad: ['eipäd', 'aipäd'], iphone: ['eifoun', 'aifoun'],
  key: ['ki'], account: ['akaunt'], benchmark: ['bentschmark'], outsourcing: ['autsorsing'], recruiting: ['rikruting'],
  marketing: ['marketing'], online_: [],
};

const LETTER_NAMES = {
  a: 'a', b: 'be', c: 'ze', d: 'de', e: 'e', f: 'ef', g: 'ge', h: 'ha', i: 'i', j: 'jot', k: 'ka', l: 'el', m: 'em',
  n: 'en', o: 'o', p: 'pe', q: 'ku', r: 'er', s: 'es', t: 'te', u: 'u', v: 'fau', w: 'we', x: 'ix', y: 'ypsilon', z: 'zet',
  ä: 'ä', ö: 'ö', ü: 'ü',
};

const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const CURRENCY_PREFIX = { '€': 'euro', '$': 'dollar', '£': 'pfund' };

const LETTER = /[a-zäöüßàáâéèêëíìîïóòôúùûçñ]/i;
const LEAD_STRIP = /^[\s"„“”‚‘’'«»‹›(\[{¿¡*_`~]+/;
const TRAIL_STRIP = /[\s"„“”‚‘’'«»‹›)\]}!?;:,…*_`~]+$/;
const PROTECTED_SPACE = /[\u00A0\u202F\u2009]/;

/** Nur Buchstaben (klein), Ziffern werden entfernt. */
function lettersOnly(s) {
  return s.toLowerCase().replace(/ß/g, 'ss').replace(/[^a-zäöüàáâéèêëíìîïóòôúùûçñ]/g, '');
}

function spellLetters(word) {
  return [...word.toLowerCase()].map((ch) => LETTER_NAMES[ch] || ch).join('');
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function combine(heads, tails, limitHeads = 3, limitTails = 3) {
  const out = [];
  for (const a of heads.slice(0, limitHeads)) for (const b of tails.slice(0, limitTails)) out.push(a + b);
  return out;
}

/** Abkürzung nachschlagen: mit Punkt, mehrteilig ohne Punkte/Leerzeichen, oder ohne Punkt geschrieben. */
function abbreviationForms(core) {
  const lower = core.toLowerCase();
  if (ABBREVIATIONS[lower]) {
    const letter = /^[a-zäöü]\.$/.test(lower) ? [LETTER_NAMES[lower[0]]] : [];
    return uniq([...ABBREVIATIONS[lower], ...letter]);
  }
  if (lower.includes('.')) {
    const compact = lower.replace(/[.\s\u00A0\u202F\u2009]/g, '');
    if (MULTI_ABBREVIATIONS[compact] && /^([a-zäöü]{1,4}\.\s*){2,}$/.test(lower.replace(/[\u00A0\u202F\u2009]/g, ' '))) {
      return MULTI_ABBREVIATIONS[compact].slice();
    }
    if (BARE_ABBREVIATIONS[compact] && compact.length >= 2) return BARE_ABBREVIATIONS[compact].slice();
    return null;
  }
  if (BARE_ABBREVIATIONS[lower]) return BARE_ABBREVIATIONS[lower].slice();
  return null;
}

/** Englische Lehnwörter (auch in Zusammensetzungen wie "Software-Update" oder "Teamleiter"). */
function loanwordForms(core) {
  const parts = core.split(/[-/]/).map(lettersOnly).filter(Boolean);
  if (parts.length > 1) {
    let variants = [''];
    let changed = false;
    for (const p of parts) {
      const alt = LOANWORDS[p];
      if (alt && alt.length) changed = true;
      variants = combine(variants, alt && alt.length ? alt : [p], 4, 2);
    }
    return changed ? variants : [];
  }
  const word = parts[0] || '';
  if (LOANWORDS[word] && LOANWORDS[word].length) return LOANWORDS[word].slice();
  // Anfang oder Ende einer Zusammensetzung ("Teamleiter", "Kundenservice")
  for (const [en, alts] of Object.entries(LOANWORDS)) {
    if (en.length < 4 || !alts.length || word === en) continue;
    if (word.startsWith(en) && word.length - en.length >= 3) return alts.map((a) => a + word.slice(en.length));
    if (word.endsWith(en) && word.length - en.length >= 3) return alts.map((a) => word.slice(0, -en.length) + a);
  }
  return [];
}

/** Internetadressen und E-Mail-Adressen: "www.coetu.tv" -> "wwwpunktcoetupunkttv". */
function urlForms(core) {
  let s = core.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const pieces = s.split(/([.@/])/).filter(Boolean);
  const words = pieces.map((p) => (p === '.' ? 'punkt' : p === '@' ? 'at' : p === '/' ? 'slash' : lettersOnly(p) || digitsToWords(p)));
  const spelledTld = pieces.length > 2 && pieces[pieces.length - 1].length <= 3 ? spellLetters(pieces[pieces.length - 1]) : null;
  const out = [words.join('')];
  if (spelledTld) out.push(words.slice(0, -1).join('') + spelledTld);
  if (/^www\./i.test(s)) out.push(words.slice(2).join(''), 'wewewe' + words.slice(1).join(''));
  return uniq(out.concat(out.map((f) => f.replace(/at/g, 'ät'))));
}

/**
 * Sprechformen eines Tokens (so wie es im Text steht, inklusive Satzzeichen).
 * Liefert eine Liste, weil manches unterschiedlich ausgesprochen wird. Leere Liste = wird nicht gesprochen.
 */
export function spokenForms(raw) {
  if (!raw) return [];
  // Anführungszeichen, Klammern, Satzzeichen und Markdown-Zeichen am Rand abtrennen; ein Punkt hinter einer
  // schließenden Klammer oder einem Anführungszeichen ("3).", "2026“.") gehört zum Satz, nicht zur Zahl.
  let core = raw.replace(LEAD_STRIP, '').replace(TRAIL_STRIP, '');
  if (/[)\]}"“”»’'*_`~]\.+$/.test(core)) core = core.replace(/\.+$/, '').replace(TRAIL_STRIP, '');
  if (!core) return [];

  // Geschützte Leerzeichen innerhalb eines Tokens ("20 000", "z. B." mit festem Leerzeichen)
  if (PROTECTED_SPACE.test(core)) {
    const compact = core.replace(/[\u00A0\u202F\u2009]+/g, '');
    if (/^[+\-−–±€$£]?\d[\d.,'’]*$/.test(compact)) return spokenForms(compact);
    const abbr = abbreviationForms(core);
    if (abbr) return abbr;
    const parts = core.split(/[\u00A0\u202F\u2009]+/).map((p) => spokenForms(p)).filter((f) => f.length);
    return parts.length ? [parts.map((f) => f[0]).join('')] : [];
  }

  if (/^(https?:\/\/|www\.)\S+$/i.test(core) || /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(core)) return urlForms(core);

  // Abkürzungen mit Punkt haben Vorrang vor gleich lautenden Einheiten ("d. h." vs. "h" = Stunden).
  const abbr = abbreviationForms(core);
  const unit = unitForms(core) || (core.endsWith('.') ? unitForms(core.slice(0, -1)) : null);
  if (abbr || unit) return uniq([...(core.endsWith('.') ? abbr || [] : []), ...(unit || []), ...(abbr || [])]);

  // Einzelner Buchstabe mit Punkt ("Variante B.") wird als Buchstabe gesprochen.
  const lower = core.toLowerCase();
  if (/^[a-zäöü]\.$/.test(lower)) return uniq([lower[0], LETTER_NAMES[lower[0]]]);

  // Datum ohne Jahr ("27.10.") und Ordnungszahl ("3.") – vor dem Entfernen des Satzende-Punkts
  const dateNoYear = /^(\d{1,2})\.(\d{1,2})\.$/.exec(core);
  if (dateNoYear) {
    const forms = dateForms(Number(dateNoYear[1]), Number(dateNoYear[2]), null);
    if (forms.length) return uniq([...forms, ...decimalForms(dateNoYear[1], dateNoYear[2], 'punkt')]);
  }
  const ordinalMatch = /^(\d{1,4})\.$/.exec(core);
  if (ordinalMatch) {
    const n = Number(ordinalMatch[1]);
    return uniq([...ordinalForms(n), ...cardinalForms(n)]);
  }
  core = core.replace(/\.+$/, '');
  if (!core) return [];

  const numeric = numericForms(core);
  if (numeric) return numeric;

  // Zahl mit Einheit oder Endung direkt dran: "50%", "80°C", "3-fach", "2026er", "10mm", "2x", "100%ig".
  const mixed = /^([+\-−–±]?\d[\d.,'’]*)(-?)([^\d]+)$/.exec(core);
  if (mixed) {
    const numberPart = numericForms(mixed[1]) || [];
    const rest = mixed[3];
    let restForms = unitForms(rest);
    if (!restForms && /^[x×]$/i.test(rest)) restForms = ['mal'];
    if (!restForms && /^%ig$/i.test(rest)) restForms = ['prozentig'];
    if (!restForms) restForms = LETTER.test(rest) ? [lettersOnly(rest)] : spokenForms(rest);
    if (numberPart.length && restForms.length) return uniq(combine(numberPart, restForms));
  }
  // "x2" -> "malzwei"
  const times = /^[x×](\d+)$/i.exec(core);
  if (times) return uniq(cardinalForms(Number(times[1])).map((f) => 'mal' + f));
  // Zahl mit Prozent-/Einheitenbereich: "10–20%"
  const rangeUnit = /^(\d[\d.,]*)[–—-](\d[\d.,]*)([^\d]+)$/.exec(core);
  if (rangeUnit) {
    const a = numericForms(rangeUnit[1]);
    const b = numericForms(rangeUnit[2]);
    const u = unitForms(rangeUnit[3]);
    if (a && b && u) return uniq(combine(combine(a, ['bis']), combine(b, u)));
  }

  // Wörter mit Ziffern mittendrin (Typenbezeichnungen wie "A4", "M8", "6205-2RS"): Buchstaben buchstabieren.
  if (/\d/.test(core) && LETTER.test(core)) {
    const parts = core.match(/\d+|[^\d\W_]+/gu) || [];
    const spoken = parts.map((p) => (/^\d+$/.test(p) ? integerForms(p)[0] : p.length <= 3 ? spellLetters(p) : lettersOnly(p)));
    const plain = parts.map((p) => (/^\d+$/.test(p) ? integerForms(p)[0] : lettersOnly(p)));
    return uniq([spoken.join(''), plain.join('')]);
  }

  if (!LETTER.test(core)) {
    // Reine Zeichen: Gedankenstrich, Schrägstrich usw. werden nicht gesprochen.
    return UNITS[core] ? UNITS[core].slice() : [];
  }

  const word = lettersOnly(core);
  if (!word) return [];
  const forms = [word];
  // Abkürzungen in Großbuchstaben ("DIN", "ISO", "KI") werden als Wort oder buchstabiert gesprochen.
  const letters = core.replace(/[^A-Za-zÄÖÜ]/g, '');
  if (letters.length >= 2 && letters.length <= 6 && letters === letters.toUpperCase()) forms.push(spellLetters(letters));
  // Gendersternchen & Co. ("Mitarbeiter*innen", "Kolleg:innen") – auch ohne die Endung.
  if (/[*:_]innen$/i.test(core) || /\/-?innen$/i.test(core)) forms.push(lettersOnly(core.replace(/[*:_/-]+innen$/i, '')));
  // Schrägstrich zwischen Wörtern ("Ein-/Ausbau", "und/oder"): auch mit "und"/"oder" gesprochen
  if (/[a-zäöüß]-?\/[a-zäöüß]/i.test(core)) {
    const [a, b] = core.split('/');
    forms.push(lettersOnly(a) + 'und' + lettersOnly(b), lettersOnly(a) + 'oder' + lettersOnly(b));
  }
  forms.push(...loanwordForms(core));
  return uniq(forms);
}

/** Datum: Tag und Monat als Ordnungszahl bzw. Monatsname, optional mit Jahr. */
function dateForms(day, month, year) {
  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12)) return [];
  const years = year ? cardinalForms(Number(year)).slice(0, 2) : [''];
  const out = [];
  for (const d of ordinalForms(day).filter((f) => /(er|en)$/.test(f))) {
    for (const mo of [MONTHS[month - 1], ...ordinalForms(month).filter((f) => /(er|en)$/.test(f))]) {
      for (const y of years) out.push(d + mo + y);
    }
  }
  return out;
}

/** Uhrzeit: "10:30" -> "zehnuhrdreißig", "zehndreißig", "halbelf". */
function timeForms(h, mi) {
  const hw = numberToWords(h);
  const mw = mi === 0 ? '' : numberToWords(mi);
  const out = [hw + 'uhr' + mw, hw + mw];
  if (mi === 0) out.push(hw);
  const next = numberToWords(((h % 12) + 1) % 12 || 12);
  const cur = numberToWords(h % 12 || 12);
  if (mi === 30) out.push('halb' + next);
  if (mi === 15) out.push('viertelnach' + cur, 'viertel' + next);
  if (mi === 45) out.push('viertelvor' + next, 'dreiviertel' + next);
  return out;
}

/** Zahlen ohne Einheit: Vorzeichen, Währung vorne, Ganzzahlen, Tausenderpunkte, Dezimalkomma, Brüche, … */
function numericForms(core) {
  let s = core;
  let signs = [''];
  const sign = /^[+\-−–±]/.exec(s);
  if (sign && /\d/.test(s[1] || '')) {
    s = s.slice(1);
    signs = sign[0] === '+' ? ['plus', ''] : sign[0] === '±' ? ['plusminus'] : ['minus'];
  }
  let currency = null;
  const cur = /^([€$£])(\d.*)$/.exec(s);
  if (cur) {
    currency = CURRENCY_PREFIX[cur[1]];
    s = cur[2];
  }
  s = s.replace(/,[-–]+$/, ''); // "49,-"
  let base = plainNumberForms(s);
  if (!base) return null;
  if (currency) {
    const cents = /^(\d+),(\d{2})$/.exec(s);
    const withUnit = base.map((f) => f + currency);
    if (cents) withUnit.push(...combine(integerForms(cents[1]), [currency + numberToWords(Number(cents[2]))]));
    base = withUnit;
  }
  return uniq(combine(signs, base, 3, 12));
}

function plainNumberForms(s) {
  let m;
  if (/^\d+$/.test(s)) return integerForms(s);
  // Tausendertrennzeichen: 1.500 / 20.000 / 1'500
  if (/^\d{1,3}([.'’]\d{3})+$/.test(s)) return cardinalForms(Number(s.replace(/[.'’]/g, '')));
  // Dezimalzahl mit Komma: 3,5 / 0,05 / 1.234,5
  if ((m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d+)$/.exec(s))) return decimalForms(m[1].replace(/\./g, ''), m[2]);
  // Dezimalpunkt (englische Schreibweise, Versionen): 4.0 / 3.5
  if ((m = /^(\d+)\.(\d{1,2})$/.exec(s))) {
    return uniq([...decimalForms(m[1], m[2], 'punkt'), ...decimalForms(m[1], m[2], 'komma'), numberToWords(Number(m[1])) + digitsToWords(m[2])]);
  }
  // Versionsnummer 1.2.3
  if (/^\d+(\.\d+){2,}$/.test(s) && !/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(s)) {
    return [s.split('.').map((p) => integerForms(p)[0]).join('punkt')];
  }
  // Uhrzeit 9:30 / 14:05, Verhältnis 1:1 / 16:9
  if ((m = /^(\d{1,3}):(\d{1,3})$/.exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const ratio = combine(combine(integerForms(m[1]), ['zu']), integerForms(m[2]));
    if (m[2].length === 2 && a <= 24 && b < 60) return uniq([...timeForms(a, b), ...ratio]);
    return uniq(ratio);
  }
  // Datum 27.10.2026
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s))) {
    const forms = dateForms(Number(m[1]), Number(m[2]), m[3]);
    if (forms.length) return uniq(forms);
  }
  // Bereich 10–20 / 1-3 / 2,5–3,5
  if ((m = /^(\d[\d.,]*)[–—-](\d[\d.,]*)$/.exec(s))) {
    const a = plainNumberForms(m[1]);
    const b = plainNumberForms(m[2]);
    if (a && b) return uniq([...combine(combine(a, ['bis']), b), ...combine(combine(a.map((f) => (f === 'eins' ? 'ein' : f)), ['bis']), b)]);
  }
  // Brüche und Schrägstriche: 1/2, 3/4, 24/7, 50/50, 2025/26
  if ((m = /^(\d+)\/(\d+)$/.exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const out = [];
    const word = b >= 2 && b <= 100 && a < b ? fractionWord(b) : '';
    if (word && m[1].length <= 2) out.push((a === 1 ? 'ein' : numberToWords(a)) + word);
    out.push(...combine(integerForms(m[1]), integerForms(m[2]), 2, 2));
    out.push(...combine(combine(integerForms(m[1]), ['durch']), integerForms(m[2]), 1, 1));
    if (m[1].length === 4) {
      out.push(...combine(combine(integerForms(m[1]), ['bis']), integerForms(m[2]), 1, 1));
      if (m[2].length === 2) out.push(...combine(combine(integerForms(m[1]), ['bis']), cardinalForms(Number(m[1].slice(0, 2) + m[2])), 1, 1));
    }
    return uniq(out);
  }
  // Unicode-Brüche: ½, 1½, ¾
  if ((m = /^(\d*)([½⅓⅔¼¾⅕⅛])$/.exec(s))) {
    const [num, den] = UNICODE_FRACTIONS[m[2]];
    return uniq(vulgarFractionForms(m[1], num, den));
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Lautschlüssel: macht unterschiedliche Schreibweisen ähnlicher Laute gleich, damit Erkennungsfehler
// wie "lage"/"Lager" oder "weltlage"/"Wälzlager" nur kleine Abstände ergeben. Gleiche Funktion für
// Vortragstext und erkannte Wörter, es kommt also nur auf Konsistenz an, nicht auf Lautschrift.
// ö und ü bekommen eigene Zeichen, damit z. B. "für" und "vier" verschieden bleiben.
// ---------------------------------------------------------------------------------------------------------

const KEY_RULES = [
  [/ß/g, 'ss'], [/[äæ]/g, 'e'], [/[öœ]/g, 'Q'], [/ü/g, 'Y'], [/[àáâ]/g, 'a'], [/[éèêë]/g, 'e'], [/[íìîï]/g, 'i'],
  [/[óòô]/g, 'o'], [/[úùû]/g, 'u'], [/ç/g, 's'], [/ñ/g, 'n'],
  [/sch/g, 'S'], [/chs/g, 'ks'], [/ch/g, 'X'], [/ck/g, 'k'], [/ph/g, 'f'], [/th/g, 't'], [/qu/g, 'kv'],
  [/dt/g, 't'], [/tz/g, 'z'], [/ts/g, 'z'], [/ds/g, 'z'], [/x/g, 'ks'], [/c/g, 'k'],
  [/ie/g, 'i'], [/ey|ay|ai/g, 'ei'], [/eu|oi|oy/g, 'oi'],
  [/([aeiouQY])h(?![aeiouQY])/g, '$1'], [/([aeiouQY])h([aeiouQY])/g, '$1$2'],
  [/v/g, 'f'], [/w/g, 'v'], [/y/g, 'i'], [/b/g, 'p'], [/d/g, 't'], [/g/g, 'k'],
  [/(.)\1+/g, '$1'],
];

/** Grober deutscher Lautschlüssel aus Buchstaben (klein). Nicht-Buchstaben werden entfernt. */
export function phoneticKey(text) {
  let s = String(text).toLowerCase().replace(/[^a-zäöüßàáâéèêëíìîïóòôúùûçñ]/g, '');
  for (const [re, rep] of KEY_RULES) s = s.replace(re, rep);
  return s;
}

// Häufige Funktionswörter: Sie kommen überall vor und sagen wenig darüber aus, wo im Text man gerade ist.
export const STOPWORDS = new Set(`
der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner
und oder aber denn sondern doch als wie wenn ob dass daß weil da damit sodass
in im ins an am ans auf aus bei beim mit nach von vom zu zum zur für über unter vor hinter neben zwischen durch gegen ohne um bis seit ab
ist sind war waren bin bist sein wird werden wurde wurden worden hat haben hatte hatten habe hast kann können konnte muss müssen soll sollen will wollen darf
es er sie wir ihr ich du man sich mich mir dich dir uns euch ihn ihm ihnen ihre ihren ihrem ihrer sein seine seinen seinem seiner unser unsere unseren unserem unserer
nicht auch noch nur schon dann so sehr mehr hier dort jetzt nun ja nein mal also eben halt wohl
was wer wo wann warum wie welche welcher welches dies diese dieser dieses diesen diesem jede jeder jedes jeden
`.split(/\s+/).filter(Boolean));

// Füllwörter und Verlegenheitslaute, wie die Erkennung sie ausgibt ("äh" kommt oft als "e" an).
export const FILLERS = new Set(['äh', 'ähm', 'äm', 'öh', 'öhm', 'ehm', 'hm', 'hmm', 'mhm', 'mh', 'e', 'eh', 'ah', 'oh', 'm', 'ä', 'ö', 'ehe']);

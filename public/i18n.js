/*
 * Traduction de l'interface. Le français est la langue source : il reste écrit tel
 * quel dans le code, sans clé.
 *
 * Pour une autre langue, chaque texte affiché (nœuds texte et attributs title,
 * placeholder, aria-label, alt) est cherché dans public/i18n/<code>.js, y compris le
 * contenu ajouté ensuite par le JavaScript (MutationObserver). Un texte absent du
 * dictionnaire reste en français.
 *
 * Ajouter une langue :
 *   1. copier public/i18n/en.js en public/i18n/<code>.js, remplacer `.en =` par
 *      `.<code> =` et traduire les valeurs (jamais les clés françaises) ;
 *   2. ajouter la langue dans LANGUAGES ci-dessous (code, drapeau, nom, locale).
 * Le sélecteur, la mémorisation du choix et le chargement du fichier suivent.
 *
 * Changer de langue recharge la page : les dates et nombres formatés par le code
 * (tdLocale()) suivent ainsi la langue sans re-rendu spécifique.
 *
 * Le serveur reprend ce moteur et ces dictionnaires (src/i18n.ts) pour ses journaux et
 * ses notifications, dans la dernière langue choisie depuis l'interface.
 */
(function () {
  const STORAGE_KEY = 'td_lang';
  const LANGUAGES = [
    { code: 'fr', flag: '🇫🇷', label: 'Français', locale: 'fr-FR' },
    { code: 'en', flag: '🇬🇧', label: 'English', locale: 'en-GB' },
  ];
  const SOURCE = 'fr';
  const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt'];
  const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  const supported = code => LANGUAGES.some(lang => lang.code === code);

  let chosen = false;
  function readLanguage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (supported(saved)) {
        chosen = true;
        return saved;
      }
    } catch { /* stockage indisponible : langue du navigateur */ }
    const browser = String(navigator.language || '').slice(0, 2).toLowerCase();
    return supported(browser) ? browser : SOURCE;
  }

  const current = readLanguage();
  document.documentElement.lang = current;
  const translating = current !== SOURCE;

  // Script lu en synchrone dans <head> : le dictionnaire est chargé avant le corps.
  if (translating && !window.TD_I18N?.[current] && typeof document.write === 'function') {
    document.write(`<script src="/i18n/${current}.js"><\/script>`);
  }

  const normalize = text => String(text).replace(/\s+/g, ' ').trim();
  const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let compiled = null;
  function dictionary() {
    if (compiled) return compiled;
    const source = window.TD_I18N?.[current] || { exact: {}, patterns: [] };
    compiled = { exact: new Map(), patterns: [], outputs: new Set() };
    for (const [fr, translated] of Object.entries(source.exact || {})) {
      compiled.exact.set(normalize(fr), translated);
      compiled.outputs.add(translated);
    }
    for (const [fr, translated] of source.patterns || []) {
      // « {} » marque une valeur variable, éventuellement vide ; la traduction la
      // reprend par {1}, {2}… Groupes paresseux : avec « {}{} », le premier reste vide.
      const regex = new RegExp(`^${normalize(fr).split('{}').map(escapeRegex).join('(.*?)')}$`, 's');
      compiled.patterns.push({ regex, translated });
    }
    return compiled;
  }

  function translate(text) {
    if (!translating || text == null) return text;
    const raw = String(text);
    const key = normalize(raw);
    const { exact, patterns, outputs } = dictionary();
    if (!key || !/[A-Za-zÀ-ÿ]{2}/.test(key) || outputs.has(key)) return text;
    let result = exact.get(key);
    if (result === undefined) {
      for (const { regex, translated } of patterns) {
        const match = regex.exec(key);
        if (match) {
          result = translated.replace(/\{(\d+)\}/g, (_, index) => translate(match[Number(index)] ?? ''));
          break;
        }
      }
    }
    if (result === undefined) return text;
    // Conserve les espaces de bord, significatifs entre deux éléments inline.
    return raw.match(/^\s*/)[0] + result + raw.match(/\s*$/)[0];
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || SKIPPED_TAGS.has(parent.tagName) || parent.closest('[data-no-i18n], [contenteditable="true"]')) return;
    const next = translate(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function translateAttributes(element) {
    // Le contenu d'un textarea ou d'un bloc de code reste intact, pas ses infobulles.
    if (element.closest('script, style, [data-no-i18n], [contenteditable="true"]')) return;
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value) continue;
      const next = translate(value);
      if (next !== value) element.setAttribute(name, next);
    }
    if (element.tagName === 'INPUT' && ['button', 'submit'].includes(element.type) && element.value) {
      const next = translate(element.value);
      if (next !== element.value) element.value = next;
    }
  }

  function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateAttributes(node);
    }
  }

  function renderSelectors() {
    document.querySelectorAll('[data-lang-select]').forEach(select => {
      if (select.options.length) return;
      for (const lang of LANGUAGES) {
        const option = new Option(`${lang.flag} ${lang.code.toUpperCase()}`, lang.code);
        option.title = lang.label;
        select.add(option);
      }
      select.value = current;
      select.title = (LANGUAGES.find(lang => lang.code === current) || LANGUAGES[0]).label;
      select.setAttribute('data-no-i18n', '');
      select.addEventListener('change', () => window.tdSetLanguage(select.value));
    });
  }

  window.tdLanguage = () => current;
  // Vrai si la langue vient d'un choix fait dans le sélecteur, pas du navigateur.
  window.tdLanguageChosen = () => chosen;
  window.tdLocale = () => (LANGUAGES.find(lang => lang.code === current) || LANGUAGES[0]).locale;
  window.tdT = text => translate(text);
  window.tdSetLanguage = code => {
    if (!supported(code) || code === current) return;
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* choix non mémorisé */ }
    location.reload();
  };

  if (translating) {
    for (const name of ['alert', 'confirm', 'prompt']) {
      const native = window[name].bind(window);
      window[name] = (message, ...rest) => native(translate(message), ...rest);
    }
  }

  function start() {
    renderSelectors();
    if (!translating) return;
    translateTree(document.body);
    document.title = translate(document.title);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') translateTextNode(record.target);
        else if (record.type === 'attributes') translateAttributes(record.target);
        else record.addedNodes.forEach(translateTree);
      }
    }).observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES, 'value'],
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

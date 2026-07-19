/* ============================================================================
 * EPAL GROUP ERP  ·  platform/core/flags.js
 * ----------------------------------------------------------------------------
 * REAL COUNTRY FLAGS, everywhere, automatically — by COUNTRY NAME or ISO code.
 *
 * WHY THIS EXISTS: flag emoji (🇳🇵) don't render on Windows/Chromium (they
 * degrade to bare "NP" letters). The fix is the bundled 'Twemoji Country Flags'
 * web font (see tokens.css @font-face) which draws them as real flag images on
 * every OS. This file is the OTHER half: turning whatever a screen has — a
 * country NAME ("Nepal"), a 2-letter ISO code ("NP"), or an existing flag
 * emoji — into that flag, so a flag renders automatically wherever a country
 * appears, and a NEW country added by name Just Works (its name is looked up in
 * the table below → ISO code → flag). No per-country wiring, no SVG bundle.
 *
 * PUBLIC API (global, usable by ANY view):
 *   EPAL.flag(input)      -> HTML string: <span class="flag-emoji">🇳🇵</span>
 *   EPAL.flagEmoji(input) -> the raw emoji string (no wrapper), or '' if unknown
 *   EPAL.countryCode(name)-> ISO-2 code for a name/code, or '' if unknown
 *
 * `input` may be: a country name (case/space/punctuation-insensitive, with
 * common aliases like UK/USA/UAE/Korea), a 2-letter ISO code, or a flag emoji.
 * Unknown → a neutral globe, never a broken glyph.
 *
 * ==> LARAVEL MAPPING: none — this is pure presentation. The backend already
 *     serves the country's real ISO code (countries.code) where it has one;
 *     this maps by NAME too so demo data and free-typed countries also render.
 * ========================================================================*/
(function (EPAL) {
  'use strict';

  // Country NAME -> ISO 3166-1 alpha-2 code. Lower-cased, non-alphanumerics
  // stripped, on lookup — so "Korea, South" / "korea south" / "SouthKorea"
  // all hit the same key. Common business aliases included at the end.
  var NAME_TO_CODE = {
    afghanistan:'af', albania:'al', algeria:'dz', andorra:'ad', angola:'ao',
    argentina:'ar', armenia:'am', australia:'au', austria:'at', azerbaijan:'az',
    bahamas:'bs', bahrain:'bh', bangladesh:'bd', barbados:'bb', belarus:'by',
    belgium:'be', belize:'bz', benin:'bj', bhutan:'bt', bolivia:'bo',
    bosniaandherzegovina:'ba', botswana:'bw', brazil:'br', brunei:'bn',
    bulgaria:'bg', burkinafaso:'bf', burundi:'bi', cambodia:'kh', cameroon:'cm',
    canada:'ca', capeverde:'cv', centralafricanrepublic:'cf', chad:'td',
    chile:'cl', china:'cn', colombia:'co', comoros:'km', congo:'cg',
    democraticrepublicofthecongo:'cd', costarica:'cr', cotedivoire:'ci',
    croatia:'hr', cuba:'cu', cyprus:'cy', czechia:'cz', czechrepublic:'cz',
    denmark:'dk', djibouti:'dj', dominica:'dm', dominicanrepublic:'do',
    ecuador:'ec', egypt:'eg', elsalvador:'sv', equatorialguinea:'gq',
    eritrea:'er', estonia:'ee', eswatini:'sz', ethiopia:'et', fiji:'fj',
    finland:'fi', france:'fr', gabon:'ga', gambia:'gm', georgia:'ge',
    germany:'de', ghana:'gh', greece:'gr', grenada:'gd', guatemala:'gt',
    guinea:'gn', guineabissau:'gw', guyana:'gy', haiti:'ht', honduras:'hn',
    hongkong:'hk', hungary:'hu', iceland:'is', india:'in', indonesia:'id',
    iran:'ir', iraq:'iq', ireland:'ie', israel:'il', italy:'it', jamaica:'jm',
    japan:'jp', jordan:'jo', kazakhstan:'kz', kenya:'ke', kiribati:'ki',
    kuwait:'kw', kyrgyzstan:'kg', laos:'la', latvia:'lv', lebanon:'lb',
    lesotho:'ls', liberia:'lr', libya:'ly', liechtenstein:'li', lithuania:'lt',
    luxembourg:'lu', macau:'mo', madagascar:'mg', malawi:'mw', malaysia:'my',
    maldives:'mv', mali:'ml', malta:'mt', mauritania:'mr', mauritius:'mu',
    mexico:'mx', micronesia:'fm', moldova:'md', monaco:'mc', mongolia:'mn',
    montenegro:'me', morocco:'ma', mozambique:'mz', myanmar:'mm', namibia:'na',
    nauru:'nr', nepal:'np', netherlands:'nl', newzealand:'nz', nicaragua:'ni',
    niger:'ne', nigeria:'ng', northkorea:'kp', northmacedonia:'mk', norway:'no',
    oman:'om', pakistan:'pk', palau:'pw', palestine:'ps', panama:'pa',
    papuanewguinea:'pg', paraguay:'py', peru:'pe', philippines:'ph', poland:'pl',
    portugal:'pt', qatar:'qa', romania:'ro', russia:'ru', rwanda:'rw',
    saintkittsandnevis:'kn', saintlucia:'lc', samoa:'ws', sanmarino:'sm',
    saudiarabia:'sa', senegal:'sn', serbia:'rs', seychelles:'sc', sierraleone:'sl',
    singapore:'sg', slovakia:'sk', slovenia:'si', solomonislands:'sb', somalia:'so',
    southafrica:'za', southkorea:'kr', southsudan:'ss', spain:'es', srilanka:'lk',
    sudan:'sd', suriname:'sr', sweden:'se', switzerland:'ch', syria:'sy',
    taiwan:'tw', tajikistan:'tj', tanzania:'tz', thailand:'th', timorleste:'tl',
    togo:'tg', tonga:'to', trinidadandtobago:'tt', tunisia:'tn', turkey:'tr',
    turkmenistan:'tm', tuvalu:'tv', uganda:'ug', ukraine:'ua',
    unitedarabemirates:'ae', unitedkingdom:'gb', unitedstates:'us', uruguay:'uy',
    uzbekistan:'uz', vanuatu:'vu', vaticancity:'va', venezuela:'ve', vietnam:'vn',
    yemen:'ye', zambia:'zm', zimbabwe:'zw',
    // ---- common aliases / short forms the data actually uses ----
    uk:'gb', greatbritain:'gb', england:'gb', usa:'us', unitedstatesofamerica:'us',
    uae:'ae', emirates:'ae', korea:'kr', koreasouth:'kr', republicofkorea:'kr',
    koreanorth:'kp', schengen:'eu', europeanunion:'eu', eu:'eu', russianfederation:'ru',
    vietnamsocialistrepublic:'vn', ksa:'sa', png:'pg', drc:'cd', bosnia:'ba',
    macedonia:'mk', swaziland:'sz', burma:'mm', ivorycoast:'ci', capverde:'cv'
  };

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // ISO-2 code -> its flag emoji (two regional-indicator symbols). 'np' -> 🇳🇵.
  // 'eu' has a real regional-indicator pair too (🇪🇺).
  function codeToEmoji(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return '';
    var A = 0x1F1E6, base = 'A'.charCodeAt(0);
    return String.fromCodePoint(A + code.charCodeAt(0) - base) +
           String.fromCodePoint(A + code.charCodeAt(1) - base);
  }

  // input: country NAME, ISO-2 code, or an existing flag emoji.
  function toEmoji(input) {
    if (!input) return '';
    var s = String(input).trim();
    // already a flag emoji? (first char is a regional indicator)
    var cp = s.codePointAt(0);
    if (cp >= 0x1F1E6 && cp <= 0x1F1FF) return s;
    // a country name or alias FIRST (so "UK" → gb, not the non-standard 🇺🇰)
    var code = NAME_TO_CODE[norm(s)];
    if (code) return codeToEmoji(code);
    // otherwise a bare 2-letter ISO code
    if (/^[A-Za-z]{2}$/.test(s)) return codeToEmoji(s);
    return '';
  }

  EPAL.flagEmoji = toEmoji;

  EPAL.countryCode = function (input) {
    if (!input) return '';
    var s = String(input).trim();
    var code = NAME_TO_CODE[norm(s)];
    if (code) return code;
    return /^[A-Za-z]{2}$/.test(s) ? s.toLowerCase() : '';
  };

  // The one screens should call. Returns an HTML string carrying the real flag
  // (rendered by the Twemoji web font), or a neutral globe when unknown.
  EPAL.flag = function (input) {
    var e = toEmoji(input);
    if (!e) return '<span class="flag-emoji flag-unknown"><i class="bi bi-globe2"></i></span>';
    return '<span class="flag-emoji">' + e + '</span>';
  };

})(window.EPAL = window.EPAL || {});

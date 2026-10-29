// मार्गदर्शिका / Guide — ALL of its text lives in this one file, so it is easy to edit later.
// Plain text only: each section is a heading plus paragraphs and/or a (numbered) list.
// Style: simple Hindi sentences; English terms (Booth, Ward, Excel, Backup…) stay in English.

/** Who to call when something fails. EDIT THIS before handing the system over. */
export const SUPPORT_CONTACT = 'Technical team (नाम और phone number यहाँ लिखें)';

export interface GuideSection {
  id: string;
  heading: string;
  text?: readonly string[];
  steps?: readonly string[];
  /** true: steps are numbered (1, 2, 3 …); false: bullet points. */
  numbered?: boolean;
}

export const GUIDE_TITLE = 'मार्गदर्शिका / Guide';

export const GUIDE: readonly GuideSection[] = [
  {
    id: 'buttons',
    heading: 'Super Admin panel में क्या-क्या है',
    numbered: true,
    steps: [
      'Counting Lock (सबसे ऊपर): ON करने पर reset, master data और booth बदलाव सबके लिए बंद हो जाते हैं। Counting पहले जैसी चलती है।',
      'Booth जोड़ें: छूटा हुआ booth जोड़ने के लिए। सिर्फ़ उन wards में, जहाँ अभी counting data नहीं है। Password नहीं चाहिए।',
      'DM account: DM का नया password (एक बार दिखता है), lock हटाना, और OTP वाला email बदलना।',
      'परीक्षण डेटा साफ़ करें (Test data reset): training या mock counting के बाद। उम्मीदवार, entries, declarations सब हटते हैं; booths, wards, voters, parties, users और settings बचे रहते हैं। कोई file नहीं चाहिए।',
      'Booth हटाएँ: गलती से जुड़ा booth हटाने के लिए। Booth no. टाइप करना होता है।',
      'मास्टर डेटा बदलें (Master data): बहुत कम — जब Geography या Voters की नई Excel आए। इससे सारा election data (parties, उम्मीदवार भी) हटता है।',
      'Password: खतरनाक काम में एक बार password डालने के बाद 15 मिनट तक दोबारा नहीं पूछा जाता। Logout करने पर यह खत्म हो जाता है।',
    ],
  },
  {
    id: 'order',
    heading: 'Master data बदलने के बाद सही क्रम',
    numbered: true,
    steps: [
      'Super Admin: Geography Excel चुनें (approved fixes अपने-आप पिछली बार वाले लगते हैं)।',
      'Super Admin: PS के Hindi names अपने-आप system वाले रहते हैं; नए हों तभी "उन्नत (Advanced)" में JSON डालें।',
      'Super Admin: Voters Excel चुनें, "जाँच करें (dry-run)" दबाएँ, फिर "मास्टर डेटा बदलें"।',
      'Counts जाँचें: 13 Panchayat Samitis, 231 PS wards, 39 ZP wards, 1,359 booths — हरे ✓ होने चाहिए।',
      'DM: parties import करें (पार्टी सूची page)।',
      'DM: RO accounts बनाएँ / update करें (RO सूची page)।',
      'DM: उम्मीदवार list import करें — पहले "जाँच करें" (dry-run), फिर save।',
      'DM: election date set करें।',
      'Super Admin: counting day से पहले Counting Lock ON करें।',
    ],
  },
  {
    id: 'file-geography',
    heading: 'File: Geography Excel',
    text: [
      'ज़रूरी columns (पहली row में ठीक यही नाम): District, PanchayatSamiti, Grampanchayat, WardNumber, PollingStationNumber, Polling Station in Hindi, Polling Station in English, PanchayatSamitiConstituenyNumber, ZillaParishadConstituencyNumber।',
      'हर row एक Gram Panchayat ward है; एक booth की कई rows हो सकती हैं।',
    ],
    steps: [
      '"District … यहाँ Churu होना चाहिए" — District column में Churu लिखें। Sample file की EXAMPLE rows हटाएँ।',
      '"Booth … की rows में अलग-अलग PS ward numbers / names" — एक ही booth की rows में अलग values हैं। Excel ठीक करें या approved fix जोड़ें।',
      '"ज़रूरी columns नहीं मिले" — पहली row के नाम sample file से मिलाएँ (spelling और space भी)।',
      '"… official count …" (पीली चेतावनी) — गिनती official numbers से अलग है; file दोबारा जाँचें।',
    ],
  },
  {
    id: 'file-voters',
    heading: 'File: Voters Excel',
    text: [
      'Sample (template) columns: panchayat_samiti, booth_no, voters_male, voters_female, voters_total, voters_other (optional)। हर booth की एक row।',
      'या polling-station file (sheet "Sheet1_withvoters" और "Sheet3") भी चलती है।',
    ],
    steps: [
      '"Booth … के voters इस file में नहीं हैं" — उस booth की row जोड़ें; हर booth होना चाहिए।',
      '"Booth … Geography file में नहीं है" — PS name या booth no. Geography file से मिलाएँ।',
      '"Total … male + female + other … बराबर होने चाहिए" — जोड़ ठीक करें।',
      '"एक ही Booth एक से ज़्यादा बार" — दोहराई गई row हटाएँ।',
    ],
  },
  {
    id: 'file-advanced',
    heading: 'Files: PS Hindi names और approved fixes (Advanced, JSON)',
    text: [
      'Hindi names का रूप: { "CHURU PANCHAYAT SAMITI": "चूरू", … } — बाईं ओर English name ठीक वैसा जैसा Geography file में है।',
      'Fixes की हर entry में: panchayat_samiti, booth_no, field (ps_ward_no / zp_ward_no / name_hindi / name_english), value, reason, approved_by, approved_on (YYYY-MM-DD)। जो fixes file एक बार use हो, वही अगली बार अपने-आप लगती है।',
    ],
  },
  {
    id: 'file-candidates',
    heading: 'File: उम्मीदवार list (DM)',
    text: [
      'ज़रूरी columns: panchayat_samiti, election (PS/ZP), ward_no, ballot_position, name_hindi, party_short_name, gender। बाकी columns optional हैं।',
    ],
    steps: [
      '"EXAMPLE" वाली row — sample file की note और example rows हटाएँ।',
      'Party नहीं मिली — पहले parties import करें, या party_short_name ठीक लिखें (निर्दलीय = खाली)।',
      'Ballot position — हर ward में 1, 2, 3 … बिना छोड़े।',
    ],
  },
  {
    id: 'lock',
    heading: 'Counting Lock',
    text: [
      'ON होने पर: test data reset, master data बदलना और booth जोड़ना/हटाना किसी से नहीं होगा (server रोकता है)। Counting, DM reports और बाकी काम पहले जैसे चलते हैं।',
      'OFF करने के लिए: "Lock OFF करें" दबाएँ, UNLOCK टाइप करें और password डालें। यह audit log में दर्ज होता है।',
    ],
  },
  {
    id: 'backups',
    heading: 'Backup, audit log और मदद',
    text: [
      'हर reset और booth बदलाव से ठीक पहले server पर अपने-आप backup बनता है (file churu-….sql.gz)। Backup file का नाम काम के बाद screen पर दिखता है। Server पर सिर्फ़ नए 20 backups रखे जाते हैं।',
      'Audit log कभी नहीं मिटता — किसी भी reset में नहीं।',
      'Backup से पुराना data वापस लाना (restore) technical team ही करेगी।',
      `कोई problem हो या लाल message समझ न आए: ${SUPPORT_CONTACT}। Screen का photo और backup file का नाम साथ भेजें।`,
    ],
  },
];

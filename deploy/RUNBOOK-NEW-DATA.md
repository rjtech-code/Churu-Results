# Runbook: naya geography + candidate data VPS par load karna (wipe → load)

Is runbook se purana counting/candidate data mitaya jaata hai aur naya data load hota hai.

- Har step ke baad diya gaya **verify** command chalayein.
- Agar verify ka nateeja expected se alag aaye, to **wahin ruk jaayein** aur neeche diya Rollback karein.
- Har destructive step se pehle uska backup step diya hai. Use chhodna nahi hai.

## 0. Pehle se taiyaar honi chahiye

Laptop par, repo ke gitignored folder `new data/` me (ye folder kabhi commit nahi hota):

| File | Kaise bani |
|---|---|
| `Geography_FULL_1371.xlsx` | 1359 numeric booths + 12 "A" booths (15A…). Ab `npm --prefix backend run convert:geography -- --file "new data/<raw>.xlsx" --out-dir "new data"` bhi saare 1371 booths `Geography_CLEAN_import-format.xlsx` me deta hai (A booths bhi). A booths ke liye migration `20261022000001_booth_suffix` (step 4) zaroori hai. |
| `Candidates_CLEAN_import-format.xlsx` | Data team ki saaf ki hui candidate file |
| `Parties_CPI-M.xlsx` | Party CPI(M) ki ek row |

- **Counting lock OFF hona chahiye.** Super Admin panel me "गिनती लॉक" dekhein. Lock ON hone par wipe aur import mana ho jaate hain.
- **Counting day (20 Nov 2026) par ye runbook mat chalaayein.**

## 1. VPS par shell setup

```bash
ssh root@<vps>
cd /opt/churu-results
export DC="docker compose --env-file .env.production -f docker-compose.prod.yml"
# SQL chalane ka chhota helper (sirf padhne ke liye use karein):
SQL() { $DC exec -T mysql sh -c "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" \"\$DB_NAME\" -e \"$1\""; }
mkdir -p /root/churu-backups && chmod 700 /root/churu-backups
```

**Verify:**
```bash
$DC ps
```
`mysql` aur `app` dono "Up (healthy)" dikhne chahiye.

## 2. Files laptop se VPS par bhejein

Ye step laptop par, repo folder me chalayein. Files git se nahi jaati.

```bash
ssh root@<vps> 'mkdir -p /opt/churu-results/new-data && chmod 700 /opt/churu-results/new-data'
scp "new data/Geography_FULL_1371.xlsx" \
    "new data/Candidates_CLEAN_import-format.xlsx" \
    "new data/Parties_CPI-M.xlsx" \
    root@<vps>:/opt/churu-results/new-data/
```
(`new-data/` VPS ke repo me bhi gitignored hai.)

**Verify** (dono taraf sha256 same hona chahiye):
```bash
# laptop par:
sha256sum "new data/"*_CLEAN_* "new data/Parties_CPI-M.xlsx"
# VPS par:
sha256sum /opt/churu-results/new-data/*
```

## 3. Backup (code ya data badalne se pehle)

```bash
STAMP=$(date +%F_%H%M)
$DC exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces "$DB_NAME"' \
  | gzip > /root/churu-backups/before-new-data-$STAMP.sql.gz
docker tag "$($DC images -q app)" churu-app:prev      # chalta hua app image, rollback ke liye
```

**Verify:**
```bash
gunzip -t /root/churu-backups/before-new-data-$STAMP.sql.gz && echo BACKUP-OK
ls -lh /root/churu-backups/before-new-data-$STAMP.sql.gz      # size 0 nahi hona chahiye
docker image ls churu-app                                     # 'prev' tag dikhna chahiye
```

## 4. Code update, build, migrate

```bash
git pull --ff-only
$DC build app
$DC up -d
$DC run --rm -T app npm run migrate
$DC restart app
```

**Verify:**
```bash
$DC ps
SQL "SHOW TABLES LIKE 'zp_ward_postal_assignment'"
```
`SHOW TABLES` me 1 row aani chahiye. Phir browser me site kholkar login page dekhein.

## 5. Wipe (DESTRUCTIVE)

Step 3 ka backup is wipe se pehle ka backup hai. Agar step 3 aur is step ke beech kaafi samay beeta ho, to step 3 dobara chalayein.

1. Super Admin panel (`/superadmin/login`) kholein.
2. "परीक्षण डेटा साफ़ करें" chunein, `RESET` likhein aur password dein. App apna backup bhi leta hai (`churu_backups` volume me).

**Kya mitata hai:** candidates, booth/postal entries aur unke votes, ward declarations, voided entries.

**Kya bachta hai:** Super Admin, DM, 13 PS_RO aur ZP_RO ke login, parties, district, PS rows, settings (election date, screens), audit_log (ye kabhi khaali nahi hota). Wards aur booths agle step me badlenge.

> "मास्टर डेटा बदलें" (full reset) me voter Excel zaroori hai. Nayi file me voters nahi hain, isliye yahan wo rasta use nahi hoga.

**Verify** (sab 0 aane chahiye):
```bash
SQL "SELECT (SELECT COUNT(*) FROM candidate) cand,(SELECT COUNT(*) FROM booth_entry) booth_e,(SELECT COUNT(*) FROM postal_entry) postal_e,(SELECT COUNT(*) FROM ward_declarations) decl"
```

## 6. Geography (DESTRUCTIVE: wards aur booths dobara bante hain)

PS rows naam se match hoti hain, isliye RO logins jude rehte hain. ZP postal assignments bhi mit jaate hain; unhe step 10 me dobara set karna hai.

```bash
$DC cp new-data/Geography_FULL_1371.xlsx app:/tmp/geo.xlsx
$DC exec app npm run import:geography -- --file /tmp/geo.xlsx --ps-names ../docs/ps-names.json --replace            # dry run
$DC exec app npm run import:geography -- --file /tmp/geo.xlsx --ps-names ../docs/ps-names.json --replace --commit
```
Dry run me `RESULT: DRY RUN OK` aur counts 13 / 231 / 39 / 1371 hone chahiye. Tabhi `--commit` chalayein.

**Verify:**
```bash
SQL "SELECT ward_type, COUNT(*) FROM ward GROUP BY ward_type; SELECT COUNT(*) booths FROM booth; SELECT COUNT(*) ps FROM panchayat_samiti"
```
PS 231, ZP 39, booths 1371 aur ps 13 aane chahiye. A booths: `SELECT COUNT(*) FROM booth WHERE booth_suffix <> ''` = 12.

## 7. PS ke Hindi naam

```bash
$DC exec app npm run ps:set-hindi-names -- --file ../docs/ps-names.json            # dry run
$DC exec app npm run ps:set-hindi-names -- --file ../docs/ps-names.json --commit
```

**Verify:**
```bash
SQL "SELECT name_english, name_hindi FROM panchayat_samiti ORDER BY name_english"
```
13 rows aani chahiye. TARANAGAR WEST = "तारानगर पश्चिम (भालेरी)" aur TARANAGAR EAST = "तारानगर" hona chahiye.

## 8. Party CPI(M)

```bash
$DC cp new-data/Parties_CPI-M.xlsx app:/tmp/parties.xlsx
$DC exec app npm run import:parties -- --file /tmp/parties.xlsx            # dry run
$DC exec app npm run import:parties -- --file /tmp/parties.xlsx --commit
```
Doosra rasta: DM ke admin page par "Parties" upload, isi file se.

- Party ki file me columns hain: `name_hindi`, `name_english`, `short_name`, `symbol`.
- CPI(M) ki values: भारतीय कम्युनिस्ट पार्टी (मार्क्सवादी) / Communist Party of India (Marxist) / CPI(M) / हथौड़ा, हँसिया और सितारा.
- Independent (IND) ke liye koi party nahi banti: candidate file me party ka cell khaali = निर्दलीय.

**Verify:**
```bash
SQL "SELECT short_name, name_english FROM party ORDER BY short_name"
```
Isme BJP, BSP, CPI(M), INC aur RLP dikhne chahiye.

## 9. Candidates

```bash
$DC cp new-data/Candidates_CLEAN_import-format.xlsx app:/tmp/cand.xlsx
$DC exec app npm run import:candidates -- --file /tmp/cand.xlsx            # dry run: RESULT ... OK hona chahiye
$DC exec app npm run import:candidates -- --file /tmp/cand.xlsx --commit
$DC exec app npm run ballot:report
```

**Verify:**
```bash
SQL "SELECT COUNT(*) candidates FROM candidate WHERE is_nota=0; SELECT COUNT(DISTINCT ward_id) wards FROM candidate"
```
candidates 893 aur wards 270 aane chahiye.

## 10. Screens aur ZP postal assignment

```bash
$DC exec app npm run screens:set -- --default              # dry run
$DC exec app npm run screens:set -- --default --commit
$DC exec app npm run screens:show

$DC exec app npm run zp-postal:set-default                 # dry run: 39 wards ka plan
$DC exec app npm run zp-postal:set-default -- --commit
$DC exec app npm run zp-postal:set-default                 # dobara: "nothing to change" aana chahiye
```

**Verify:**
```bash
SQL "SELECT COUNT(*) FROM zp_ward_postal_assignment"
```
39 aana chahiye.

## 11. RO accounts

Logins wipe me nahi mit-te. Pehle dekhein kaun se accounts maujood hain:
```bash
$DC exec app npm run users:list
```
Jo account nahi hai, sirf wahi banayein. Mobile number abhi nahi hain, isliye naam placeholder rakhein; DM baad me apne admin page se badal sakta hai.

```bash
while IFS='|' read -r user ps; do
  $DC exec -T app npm run users:create -- --role PS_RO --username "$user" \
    --ps "$ps PANCHAYAT SAMITI" --full-name "PS RO - $ps" --commit < /dev/null
done <<'LIST'
ro_bhanipura|BHANIPURA
ro_bidasar|BIDASAR
ro_chandgothi|CHANDGOTHI HQ RAJGARH
ro_churu_north|CHURU NORTH HQ CHURU
ro_churu|CHURU
ro_rajgarh|RAJGARH
ro_ratangarh|RATANGARH
ro_sardar_east|SARDARSHAHAR EAST
ro_sardarshahar|SARDARSHAHAR
ro_siddhmukh|SIDDHMUKH
ro_sujangarh|SUJANGARH
ro_taranagar_east|TARANAGAR EAST
ro_taranagar_west|TARANAGAR WEST(BHALERI) HQ TARANAGAR
LIST
$DC exec app npm run users:create -- --role ZP_RO --username zp_ro_churu --full-name "ZP RO - CHURU" --commit
```
Har password screen par **sirf ek baar** aata hai. Use turant kisi safe jagah note karein.

**Verify:** `users:list` me 13 PS_RO (har PS ka ek), 1 ZP_RO, 1 DM aur 1 SUPER_ADMIN dikhne chahiye.

## 12. Settings

- **Matdaan (poll) ki tareekh:** DM login → Admin → "Election date". Ye Prarup-7 aur Counting Status Report me "Poll date" ke roop me chhapti hai. Prarup-7 ke footer me "दिनांक :" bhi isi se aata hai (koi alag date nahi); "स्थान :" district ka naam hai. Footer me RO ka naam (users.full_name) RO ke download par chhapta hai; DM ke download par wo line khaali rehti hai. Upar ~20 mm jagah haath se sign ke liye hai.
  Verify:
  ```bash
  SQL "SELECT setting_value FROM app_settings WHERE setting_key='election_date'"
  ```
- **Ginti ki tareekh 20 Nov 2026:** ye setting nahi hai. Code me fixed hai (`backend/src/config/election.ts`, `COUNTING_DATE`). Report me "Counting date: 20 Nov 2026" dikhna chahiye.
- **SUPPORT_CONTACT:** ye `frontend/src/pages/superadmin/guideContent.ts` me hai. Naam aur phone milne par code badalna hoga, commit karna hoga, aur step 4 dobara chalana hoga.

## 12a. Adhikari ko 429 / login nahi ho raha

1. **Adhikari ki screen par kya likha hai, wahi poochhein:**
   - "इस यूज़रनेम से बहुत गलत कोशिशें — DM से लॉगिन खुलवाएँ" → **step 3** (DM khud theek kar sakta hai)
   - "खाता अस्थायी रूप से बंद है…" → **step 3**
   - "यहाँ से बहुत लॉगिन कोशिशें…" ya "यहाँ से बहुत अधिक अनुरोध…" → **step 4** (restart chahiye)
2. **Pakka karna ho to server log dekhein** (password kabhi log nahi hota):
   ```bash
   cd /opt/churu-results && $DC logs --tail=200 app | grep '\[rate-limit\]'
   # login-per-user / api-per-user  -> step 3
   # login-per-ip   / api-per-ip    -> step 4
   ```
3. **DM panel se kholें** (terminal ki zaroorat nahi):
   DM login → **RO सूची** → upar **"RO लॉगिन खोलें"** card → us adhikari ki row → **लॉगिन खोलें** → DM apna password daale.
   Isse ek saath hat jaata hai: account ka lock, galat koshishon ki ginti, **aur usi adhikari ke rate-limit counters**. Adhikari **wahi purana password** turant daal kar login kar sakta hai.
   Card khaali dikhe ("अभी कोई लॉगिन लॉक नहीं है") aur phir bhi 429 aaye → step 4.
4. **Poore venue wali limit lagi ho (per-IP) → app restart:**
   ```bash
   cd /opt/churu-results
   $DC restart app
   $DC logs --tail=30 app      # "listening" dikhna chahiye
   ```
   Restart **5-10 second** leta hai.
   - **Khatam ho jaata hai:** saare rate-limit counters (ye in-memory hain).
   - **Nahi badalta:** matgananā ka data, adhikariyon ke login sessions (DB mein hain — dobara login nahi karna padta), TV screens ki key sessions (TV par key dobara nahi daalni padti, screen apne aap wapas aa jaati hai), aur screens ka chalu/band state.
5. **Baar-baar ho raha ho** to limit badha dein — **step 12b** mein variable ke naam aur commands hain.

## 12b. Rate limits (counting day par badalne ho to)

Poora venue ek hi public IP ke peeche hota hai, isliye **jo limit ek adhikari ko bachati hai wo
adhikari ke hisaab se ginti hai** (login par username, uske baad user id). Per-IP wali limits sirf
flood ceiling hain — normal kaam unke paas bhi nahi pahunchta.

| Variable | Default | Kya ginta hai |
|---|---|---|
| `LOGIN_LIMIT_PER_USER` | `10` | Ek **username** ki login koshishein, per window |
| `LOGIN_LIMIT_PER_IP` | `200` | Ek **IP** se sab logins, per window (ceiling) |
| `LOGIN_WINDOW_MINUTES` | `15` | Dono login limits ka window |
| `API_LIMIT_PER_USER_PER_MIN` | `300` | Ek **logged-in adhikari** ki dashboard requests/minute |
| `API_LIMIT_PER_IP_PER_MIN` | `3000` | Ek **IP** se sab dashboard requests/minute (ceiling) |
| `PUBLIC_RATE_LIMIT_PER_MIN` | `3000` | TV screens (`/api/public`) per IP |

Account lockout (**5 galat password = 15 minute**) in limits se alag hai aur nahi badla. Wo DM ke
"RO सूची" page par "RO लॉगिन खोलें" card se hatta hai — terminal ki zaroorat nahi.

Badalna ho to (VPS par):

```bash
cd /opt/churu-results
cp backend/.env.production backend/.env.production.bak      # pehle backup
nano backend/.env.production                                 # value badlein, ya nayi line jodein
grep -E 'LOGIN_LIMIT|API_LIMIT|LOGIN_WINDOW' backend/.env.production   # jaanch lein
$DC restart app                                              # sirf restart, build nahi
$DC logs --tail=30 app                                       # "listening" dikhna chahiye
```

Galat value (jaise `0` ya khaali) par app **shuru hi nahi hoga** aur log me saaf message aayega —
aise me `.env.production.bak` wapas rakh kar phir se restart karein.

Limit lagi hai ya nahi, ye server log se pata chalta hai (password kabhi log nahi hota):

```bash
$DC logs --tail=200 app | grep '\[rate-limit\]'
# [rate-limit] login-per-user limit reached for login:ro_churu on POST /login
# [rate-limit] api-per-user limit reached for user:42 on GET /counting/wards
```

Adhikari ki screen par Hindi me dikhta hai: "बहुत अधिक प्रयास, थोड़ी देर बाद फिर प्रयास करें".

## 13. Aakhri jaanch

- PS RO se login karein → "मेरे वार्ड" me apne wards dikhne chahiye. "जिला परिषद" tab me "आपको सौंपे गए" ZP postal wards dikhne chahiye.
- ZP RO se login karein → ZP wards (read-only) dikhne chahiye, aur Counting Status Report me sirf ZP data.
- Public screen par 3 screens khulni chahiye aur "last updated" dikhna chahiye.

Kaam khatam hone par temporary files hata dein:
```bash
$DC exec app sh -c 'rm -f /tmp/*.xlsx'
rm -rf /opt/churu-results/new-data
```

## Rollback

**Data galat ho gaya** (step 5–11 me kahin bhi):
```bash
$DC stop app
gunzip -c /root/churu-backups/before-new-data-$STAMP.sql.gz \
  | $DC exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$DB_NAME"'
$DC start app
```
Verify ki counts wapas purane jaise hain:
```bash
SQL "SELECT COUNT(*) FROM booth; SELECT COUNT(*) FROM candidate WHERE is_nota=0"
```

**Naya code galat ho gaya** (step 4 ke baad app nahi chal raha):
```bash
docker tag churu-app:prev churu-app:latest
$DC up -d --no-build app
```
Agar naye code ne migration chala di thi, to upar wala data restore bhi karein. Purana dump purani tables wapas bana deta hai. Uske baad naye code ki migration dobara na chalayein.

**Teen baatein yaad rakhein:**
- Import scripts ek hi transaction me chalte hain. Agar wo fail hon to kuch save nahi hota, aur rollback ki zaroorat nahi.
- `--commit` se pehle har baar dry run zaroor padhein.
- Super Admin panel apne automatic backups `churu_backups` volume me rakhta hai. Wahan se file nikalne ke liye: `$DC cp app:/app/backend/backups/<file>.sql.gz /root/churu-backups/`.

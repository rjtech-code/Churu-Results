# Churu Results — VPS deploy (Hinglish)

Server: Ubuntu 24.04. Pehle se Nginx (80/443) aur port 3000 doosri site ke liye use ho raha hai — hum unhe nahi chhedte.
Hamari app sirf `127.0.0.1:3100` par chalti hai; Nginx us subdomain ko wahan bhejta hai. MySQL bahar se band hai.

Har command project folder (`/root/Churu-Results`) ke andar chalani hai. Chhota naam: 
`DC="docker compose -f docker-compose.prod.yml --env-file .env.production"` (neeche `$DC` likha hai).

## 1. Clone
```bash
cd /root && git clone <repo-url> Churu-Results && cd Churu-Results
export DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
```
(Docker + compose plugin install hona chahiye: `docker compose version`.)

## 2. .env.production
```bash
cp .env.production.example .env.production && chmod 600 .env.production
nano .env.production
```
- `APP_ORIGIN` = asli subdomain, `https://...`, bina `/` ke.
- Har secret ke liye ek baar yeh command chalao aur value paste karo:
  `openssl rand -base64 36 | tr -d '/+='`
  (SESSION_SECRET, DB_APP_PASSWORD, DB_MIGRATION_PASSWORD, MYSQL_ROOT_PASSWORD — sab alag alag.)
- `RO_PASSWORD_KEY` alag command se banta hai: `openssl rand -base64 32`. Isse RO ke passwords ki encrypted copy banti hai (DM "देखें" ke liye). Is key ko `.env.production` ke saath backup mein rakho; kho gayi to purane passwords dikhenge nahi (DM naya set kar sakta hai). Baad mein change mat karo.
- `TRUST_PROXY=1` rehne do.

## 3. Build aur start
```bash
$DC up -d --build
$DC ps          # mysql "healthy" hona chahiye
```
Pehli baar MySQL volume banta hai aur init script migration user + app user banata hai (passwords `.env.production` se).
App abhi crash-loop kar sakti hai jab tak migrations nahi chali — step 4 ke baad theek ho jayegi.

## 4. Migrations
```bash
$DC run --rm -T app npm run migrate
$DC restart app
```

## 5. Geography + Hindi names import
Pehle dry run (kuch save nahi hota), phir `--commit`:
```bash
$DC exec app npm run import:geography -- --file ../docs/polling-stations.xlsx --ps-names ../docs/ps-names.json
$DC exec app npm run import:geography -- --file ../docs/polling-stations.xlsx --ps-names ../docs/ps-names.json --commit
$DC exec app npm run ps:set-hindi-names -- --file ../docs/ps-names.json
$DC exec app npm run ps:set-hindi-names -- --file ../docs/ps-names.json --commit
```
Dusre scripts bhi aise hi: `$DC exec app npm run <script> -- <args>`. Excel file server par laani ho to
`docker cp file.xlsx $($DC ps -q app):/tmp/file.xlsx` aur `--file /tmp/file.xlsx`. Examples:
```bash
$DC exec app npm run import:parties    -- --file /tmp/parties.xlsx --commit
$DC exec app npm run import:voters     -- --file /tmp/voters.xlsx --commit
$DC exec app npm run import:candidates -- --file /tmp/candidates.xlsx --commit
$DC exec app npm run ballot:report
$DC exec app npm run ballot:lock       -- --ward <id> --by "Naam, pad" --commit
$DC exec app npm run screens:set       -- --file /tmp/screens.json --commit
$DC exec app npm run users:list
$DC exec app npm run users:unlock      -- --username <u>
$DC exec app npm run users:reset-password -- --username <u> --commit
```
(Har script ka exact usage uski pehli line mein hai: `backend/scripts/<naam>.ts`.)

## 6. 15 users banao (13 PS_RO, 1 ZP_RO, 1 DM)
Password khud generate hoke ek hi baar screen par aata hai — turant kisi safe jagah note karo.
```bash
$DC exec app npm run users:create -- --role PS_RO --username ro_chu_h3w8 --ps "CHURU PANCHAYAT SAMITI" --full-name "Naam" --commit
$DC exec app npm run users:create -- --role ZP_RO --username zp_ro_p4x9 --full-name "Naam" --commit
$DC exec app npm run users:create -- --role DM    --username dm_q8t3    --full-name "Naam" --commit
```
(13 PS ke liye PS_RO wali line 13 baar, har PS ka naam alag.)

Super Admin (setup panel, ek hi baar; iske baad terminal ki zaroorat nahi):
```bash
$DC exec app npm run users:create -- --role SUPER_ADMIN --username super_k7m2 --full-name "Naam" --commit
```
Login page par neeche chhota "Super Admin" link hai (`/superadmin/login`). Panel: DM khata, candidates
clear, full reset, booth add/delete, "गिनती लॉक". Har reset / booth badlav se pehle app khud backup leta
hai (volume `churu_backups`, container mein `/app/backend/backups`; sirf naye 20 rakhe jaate hain). Full
reset ke liye `.env.production` mein `DB_MIGRATION_USER` / `DB_MIGRATION_PASSWORD` hone chahiye (pehle se
hain); app inhe sirf full reset mein use karta hai. Super Admin khud lock ho jaye
ya password bhool jaye: `users:unlock` / `users:reset-password` (yahi do kaam terminal se).

Demo scripts (`demo:seed`, `demo:reset`, `demo:simulate`) `NODE_ENV=production` mein chalne se mana kar dete hain
(`scripts/lib/demo-guard.ts`). Server par kabhi mat chalana.

## 7. Nginx (sirf is subdomain ke liye)
```bash
cp deploy/nginx-chunav.conf /etc/nginx/sites-available/chunav
nano /etc/nginx/sites-available/chunav        # chunav.example.com -> asli subdomain
ln -s /etc/nginx/sites-available/chunav /etc/nginx/sites-enabled/chunav
nginx -t && systemctl reload nginx
```
DNS mein subdomain ka A record is VPS ke IP par hona chahiye.

## 8. HTTPS (certbot, sirf is subdomain ke liye)
```bash
certbot --nginx -d chunav.example.com
```
Doosri site ke certificate ko yeh nahi chhedta. Phir browser mein `https://chunav.example.com` kholo.

## 9. Baad mein update
```bash
cd /root/Churu-Results && git pull
$DC up -d --build
$DC run --rm -T app npm run migrate      # agar nayi migration aayi ho
```
Counting day ke din update mat karo.

## 10. Backup / restore
```bash
./deploy/backup.sh                                  # abhi backup (14 din rakhta hai, /root/churu-backups)
crontab -e   # roz 02:30:
30 2 * * * cd /root/Churu-Results && ./deploy/backup.sh >> /root/churu-backups/backup.log 2>&1
```
Restore (purana data replace hota hai — pehle soch lo):
```bash
gunzip -c /root/churu-backups/churu-YYYY-MM-DD_HHMM.sql.gz | $DC exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$DB_NAME"'
```
Backup file ko kabhi kabhi doosri machine par bhi copy karo (`scp`).

Super Admin panel ke automatic backups (`churu-full-reset-…sql.gz`, `churu-candidates-reset-…`,
`churu-booth-…`) sirf DATA hain (schema nahi): usi migrated database mein restore karo. Restore table
drop nahi karta (triggers bane rehte hain) aur audit_log kabhi khali nahi karta. Bahar nikalna / restore:
```bash
$DC exec app ls -l /app/backend/backups
$DC cp app:/app/backend/backups/<file>.sql.gz /root/churu-backups/
gunzip -c /root/churu-backups/<file>.sql.gz | $DC exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$DB_NAME"'
```

## 11. Logs
```bash
$DC logs -f --tail=100 app
$DC logs --tail=100 mysql
tail -f /var/log/nginx/error.log
```

## 12. Site down kya karein
1. `$DC ps` — app aur mysql "Up" hain? 
2. `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/` — 200 aaye to app theek hai, problem Nginx/DNS/certificate mein hai: `nginx -t`, `systemctl status nginx`.
3. App band ho to `$DC logs --tail=100 app` padho (env galat? migration baaki?). 
4. `$DC restart app` (mysql healthy ho tab). Phir bhi na chale: `$DC up -d`.
5. Memory: `free -m`, `docker stats --no-stream`.
6. Data kharab lage to restore (step 10) — pehle kisi se poocho.

# Ledgerly

เว็บแอปจัดการรายรับรายจ่ายภาษาไทย สร้างด้วย React, TypeScript, Cloudflare Workers, D1 และ R2

## รันในเครื่อง

ต้องใช้ Node.js 20 ขึ้นไป

```sh
cp worker/.dev.vars.example worker/.dev.vars
npm install
npm run db:local
```

เปิด terminal สองหน้าต่างจากโฟลเดอร์โปรเจกต์:

```sh
npm run dev:api
```

```sh
npm run dev
```

เปิด `http://localhost:5173` แล้วสมัครบัญชีแรก บัญชีแรกจะเป็น admin อัตโนมัติ ส่วน API อยู่ที่ `http://localhost:8787` ค่าใน `worker/.dev.vars.example` ใช้สำหรับ local development เท่านั้น; ไฟล์ `worker/.dev.vars` ถูก ignore โดย Git และห้ามนำค่าเหล่านี้ไปใช้บน Cloudflare

การอ่านข้อความ/สลิปด้วย AI ต้องตั้ง API key และ OpenAI-compatible base URL ที่หน้า **จัดการระบบ**; จากนั้นโหลดรายชื่อโมเดลและเลือกโมเดลที่จะใช้ การบันทึกรายการแบบกรอกเองและการจัดการบัญชีใช้ได้โดยไม่ต้องตั้ง AI key

ระบบลืมรหัสผ่านมี OTP อายุ 10 นาทีและใช้ได้ครั้งเดียว หากต้องการส่ง OTP หรือสรุป Gmail จริง ให้ admin ตั้ง Gmail sender และ App Password ในหน้า **จัดการระบบ** ก่อน; App Password จะถูกเข้ารหัส AES-256-GCM ก่อนบันทึก ผู้ใช้ระบุเฉพาะอีเมลผู้รับสรุป

## เตรียม Cloudflare

1. เข้าสู่ระบบ Wrangler ด้วย `npx wrangler login`.
2. สร้าง D1 database ด้วย `npx wrangler d1 create cloud-ledger-db --config worker/wrangler.toml` แล้วแทนค่า `database_id` ใน `worker/wrangler.toml` ด้วย ID ที่ได้.
3. สร้าง R2 bucket ด้วย `npx wrangler r2 bucket create cloud-ledger-receipts`.
4. ใช้ `npm run db:remote` เพื่อนำ schema ไปใช้กับ D1 production.
5. ตั้ง Worker secrets โดยรันคำสั่งต่อไปนี้ทีละคำสั่ง แล้วกรอก secret ที่ terminal ขอ:

   ```sh
   npx wrangler secret put JWT_SECRET --config worker/wrangler.toml
   npx wrangler secret put ENCRYPTION_KEY --config worker/wrangler.toml
   ```

   `JWT_SECRET` ควรเป็นค่าสุ่มยาวอย่างน้อย 32 bytes; `ENCRYPTION_KEY` ต้องเป็น Base64 ของ random 32 bytes สำหรับ AES-256-GCM ห้าม commit secrets หรือใส่ไว้ใน `vars`.

6. แก้ `APP_ORIGIN` ใน `worker/wrangler.toml` เป็น origin ของ Pages production ก่อน deploy API. CORS จะปฏิเสธ origin อื่น.
7. Deploy API ด้วย `npm run deploy:api`.
8. กำหนด `VITE_API_URL` เป็น URL ของ Worker ใน Pages build environment แล้ว deploy frontend ด้วย `npm run deploy:pages`.

ค่าเริ่มต้นของ AI คือ Gemini OpenAI-compatible base URL `https://generativelanguage.googleapis.com/v1beta/openai` และ model `gemini-3.5-flash-lite`; admin สามารถเปลี่ยน base URL, โหลดรายการโมเดล และเลือกโมเดลผ่านหน้าเว็บ

## ฟีเจอร์

- JWT authentication, PBKDF2 password hashing, first-user admin และ RBAC
- แสดง/ซ่อนรหัสผ่าน, ลืมรหัสผ่านด้วย OTP แบบใช้ครั้งเดียว และเพิกถอน session เก่าหลัง reset
- ข้อมูลบัญชี/ธุรกรรม/การแจ้งเตือนแยกตาม `user_id`
- ยอดคงเหลือปรับใน D1 batch เมื่อเพิ่ม แก้ไข หรือลบรายการ
- บันทึกข้อความและอ่านสลิปด้วย Gemini; รูปเก็บใน R2 ตาม retention policy
- สรุป Telegram, Discord และ Gmail SMTP ผ่าน `cloudflare:sockets` ตาม cron schedule ของผู้ใช้ โดย Gmail ใช้ sender credentials กลางของเว็บไซต์
- Admin จัดการผู้ใช้โดยเปลี่ยน/ปิด role ตัวเองไม่ได้, ตั้งค่า AI base URL และ model, sender Gmail และนโยบายรูปภาพ
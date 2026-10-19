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

## เตรียม Cloudflare และการ Deploy

1. เข้าสู่ระบบ Wrangler:
   ```sh
   npx wrangler login
   ```
2. สร้าง D1 database:
   ```sh
   npx wrangler d1 create cloud-ledger-db --config worker/wrangler.toml
   ```
   แล้วนำ `database_id` ที่ได้รับไปใส่ใน `worker/wrangler.toml`
3. สร้าง R2 bucket สำหรับเก็บสลิป/ใบเสร็จ:
   ```sh
   npx wrangler r2 bucket create cloud-ledger-receipts
   ```
4. รัน database migrations ขึ้น Cloudflare D1 production:
   ```sh
   npm run db:remote
   ```
5. สุ่มสร้างและตั้ง Worker Secrets สำหรับ Production:
   - **JWT_SECRET**: ข้อความสุ่มยาวอย่างน้อย 32 ตัวอักษร เช่น สุ่มด้วย:
     ```sh
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - **ENCRYPTION_KEY**: ต้องเป็น Base64 ของ random 32 bytes เช่น:
     ```sh
     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
     ```
   นำค่าที่ได้ไปตั้งผ่านคำสั่ง:
   ```sh
   npx wrangler secret put JWT_SECRET --config worker/wrangler.toml
   npx wrangler secret put ENCRYPTION_KEY --config worker/wrangler.toml
   ```
   *(ห้าม commit หรือใส่ secret ใน vars เด็ดขาด)*

6. กำหนด `APP_ORIGIN` ใน `worker/wrangler.toml` ให้ตรงกับ Domain ของเว็บใน Production (เช่น `https://money.aury.win`) เพื่อให้ CORS และระบบ Strict Cookie ทำงานถูกต้อง
7. การ Deploy มี 2 ทางเลือก:
   - **ทางเลือกที่ 1: Deploy แบบ Worker with Assets (แนะนำ)**: รัน `npm run deploy` คำสั่งจะ build frontend และ deploy ควบคู่กับ Worker API ในโดเมนเดียว
   - **ทางเลือกที่ 2: แยก Pages และ Worker API**:
     - Deploy Worker: `npm run deploy:api`
     - Deploy Pages: กำหนด `VITE_API_URL` ใน Pages environment แล้วรัน `npm run deploy:pages`
8. **การสร้างผู้ดูแลระบบคนแรก (First Admin)**:
   ผู้ใช้งานคนแรกสุดที่ลงทะเบียนผ่านระบบ (`/api/auth/register`) จะได้รับสิทธิ์เป็น `admin` โดยอัตโนมัติ หลังจากนั้นผู้ดูแลระบบสามารถเปิด/ปิดการรับสมัครสมาชิกใหม่ได้ที่หน้า **จัดการระบบ**
9. **ข้อกำหนดและการเปิดเผยเกี่ยวกับ AI (AI Disclosure)**:
   - ฟีเจอร์อ่านข้อความและสลิปใบเสร็จใช้โมเดลภายนอก (ค่าเริ่มต้น Gemini 2.5 Flash Lite ผ่าน OpenAI-compatible endpoint)
   - ข้อมูลข้อความหรือภาพสลิปจะถูกส่งไปยัง AI provider เพื่อประมวลผลตามที่ผู้ดูแลระบบตั้งค่า โดย API key จะถูกเข้ารหัสอย่างปลอดภัยในระบบและไม่ส่งไปยังเบราว์เซอร์ของผู้ใช้

## ฟีเจอร์

- JWT authentication, PBKDF2 password hashing, first-user admin และ RBAC
- แสดง/ซ่อนรหัสผ่าน, ลืมรหัสผ่านด้วย OTP แบบใช้ครั้งเดียว และเพิกถอน session เก่าหลัง reset
- ข้อมูลบัญชี/ธุรกรรม/การแจ้งเตือนแยกตาม `user_id`
- ยอดคงเหลือปรับใน D1 batch เมื่อเพิ่ม แก้ไข หรือลบรายการ
- บันทึกข้อความและอ่านสลิปด้วย Gemini; รูปเก็บใน R2 ตาม retention policy
- สรุป Telegram, Discord และ Gmail SMTP ผ่าน `cloudflare:sockets` ตาม cron schedule ของผู้ใช้ โดย Gmail ใช้ sender credentials กลางของเว็บไซต์
- Admin จัดการผู้ใช้โดยเปลี่ยน/ปิด role ตัวเองไม่ได้, ตั้งค่า AI base URL และ model, sender Gmail และนโยบายรูปภาพ
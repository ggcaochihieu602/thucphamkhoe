# ThucPhamKhoe

ThucPhamKhoe la website ban thuc pham tot cho suc khoe, gom frontend HTML/CSS/JavaScript va backend Node.js/Express ket noi MySQL. He thong co cac chuc nang chinh: quan ly san pham, gio hang, dat hang, quan ly nguoi dung, bai viet, tu van chuyen gia, dashboard admin va goi y/phan tich dinh duong bang AI logic noi bo.

## 1. Cong nghe su dung

- Backend: Node.js, Express
- Database: MySQL
- Frontend: HTML, CSS, JavaScript thuan
- Authentication: JWT
- Upload file: Multer
- Ma hoa mat khau: bcryptjs
- Quan ly source: Git/GitHub

## 2. Cau truc thu muc

```text
.
|-- index.js                              # Server Express va cac API chinh
|-- db.js                                 # Cau hinh ket noi MySQL
|-- aiLogic.js                            # Logic phan tich/goi y dinh duong
|-- aiLogic-improved.js                   # Ban logic AI cai tien/tham khao
|-- package.json                          # Script va dependencies Node.js
|-- package-lock.json
|-- database-migrations.sql               # Migration bo sung truong ca nhan hoa
|-- migration-add-personalization-fields.sql
|-- frontend/                             # Giao dien nguoi dung/admin/chuyen gia
|-- img/                                  # Anh san pham, bai viet, avatar, asset
`-- example/                              # Du lieu/anh/tai lieu minh hoa
```

## 3. Yeu cau moi truong

Can cai dat truoc:

- Node.js 18 tro len
- npm
- MySQL Server 8.x hoac MariaDB tuong thich
- Git
- Trinh duyet web

Kiem tra phien ban:

```bash
node -v
npm -v
git --version
mysql --version
```

## 4. Cai dat du an tren may local

Clone repository:

```bash
git clone https://github.com/ggcaochihieu602/thucphamkhoe.git
cd thucphamkhoe
```

Cai dependencies:

```bash
npm install
```

Neu dung PowerShell tren Windows va gap loi `running scripts is disabled`, chay bang `npm.cmd`:

```bash
npm.cmd install
```

## 5. Cau hinh database MySQL

Tao database:

```sql
CREATE DATABASE thucphamkhoe CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Mo file `db.js` va cap nhat thong tin ket noi cho dung voi MySQL tren may:

```js
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "mat_khau_mysql_cua_ban",
  database: "thucphamkhoe",
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10
});
```

Neu da co file dump database, import vao database vua tao:

```bash
mysql -u root -p thucphamkhoe < database.sql
```

Sau do chay cac file migration neu database chua co cac truong ca nhan hoa/AI:

```bash
mysql -u root -p thucphamkhoe < database-migrations.sql
mysql -u root -p thucphamkhoe < migration-add-personalization-fields.sql
```

Luu y: backend co tu dong tao/bo sung mot so bang va cot khi server khoi dong, nhung database van can co cac bang nen tang nhu `users`, `roles`, `products`, `articles`, `orders`, `order_items` neu ban khoi tao database moi hoan toan.

## 6. Chay backend

Chay production mode:

```bash
npm start
```

Chay development mode voi nodemon:

```bash
npm run dev
```

Neu PowerShell chan `npm.ps1`, dung:

```bash
npm.cmd run dev
```

Khi server chay thanh cong, terminal se hien:

```text
Server is running on port 3000
```

Backend API va static image se chay tai:

```text
http://localhost:3000
```

Thu kiem tra nhanh:

```bash
curl http://localhost:3000/products
```

## 7. Chay frontend

Frontend nam trong thu muc `frontend/`. Cac file HTML hien dang goi API mac dinh tai:

```text
http://localhost:3000
```

Cach chay don gian:

1. Dam bao backend dang chay bang `npm start` hoac `npm run dev`.
2. Mo file `frontend/index.html` bang trinh duyet.
3. Dang ky/dang nhap va thu cac trang san pham, gio hang, don hang, profile.

Mot so trang quan trong:

- `frontend/index.html`: trang chu
- `frontend/products.html`: danh sach san pham
- `frontend/cart.html`: gio hang
- `frontend/login.html`: dang nhap
- `frontend/register.html`: dang ky
- `frontend/admin-dashboard.html`: dashboard admin
- `frontend/ask-expert.html`: hoi dap chuyen gia

Co the chay frontend bang extension Live Server cua VS Code. Khi do backend van phai chay rieng o port `3000`.

## 8. Tai khoan va phan quyen

He thong su dung JWT de xac thuc. Cac API admin va chuyen gia yeu cau user co role phu hop trong database.

Khi khoi tao database moi, can dam bao co bang role va du lieu role tuong ung, vi code dang su dung cac nhom quyen nhu:

- user/khach hang
- admin
- expert/chuyen gia

Ten cot va ten role can dong bo voi database thuc te cua du an.

## 9. Kiem thu nhanh

Kiem tra cu phap cac file JavaScript chinh:

```bash
node --check index.js
node --check aiLogic.js
node --check aiLogic-improved.js
```

Kiem tra server:

```bash
npm start
```

Kiem tra cac luong chinh tren trinh duyet:

- Mo trang chu va danh sach san pham
- Dang ky tai khoan moi
- Dang nhap
- Them san pham vao gio hang
- Tao don hang
- Cap nhat ho so suc khoe
- Thu chuc nang phan tich/goi y dinh duong
- Dang nhap admin va kiem tra dashboard

## 10. Deploy len VPS

Vi du deploy tren Ubuntu VPS.

Cap nhat server:

```bash
sudo apt update
sudo apt install -y nodejs npm mysql-server git nginx
```

Clone source:

```bash
git clone https://github.com/ggcaochihieu602/thucphamkhoe.git
cd thucphamkhoe
npm install
```

Tao database tren VPS:

```bash
sudo mysql
```

```sql
CREATE DATABASE thucphamkhoe CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'thucphamkhoe_user'@'localhost' IDENTIFIED BY 'mat_khau_manh';
GRANT ALL PRIVILEGES ON thucphamkhoe.* TO 'thucphamkhoe_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Cap nhat `db.js` theo thong tin database VPS.

Chay server bang PM2:

```bash
sudo npm install -g pm2
pm2 start index.js --name thucphamkhoe
pm2 save
pm2 startup
```

Cau hinh Nginx reverse proxy:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Kich hoat site va reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Neu frontend van mo rieng tu file HTML hoac hosting tinh, can sua cac gia tri `API_BASE` trong `frontend/*.html` tu:

```js
http://localhost:3000
```

thanh domain backend:

```js
https://your-domain.com
```

## 11. Deploy len Render/Railway

Co the deploy backend Node.js len Render hoac Railway, database MySQL dung Railway, PlanetScale, Aiven hoac MySQL server rieng.

Cau hinh co ban:

- Build command: `npm install`
- Start command: `npm start`
- Runtime: Node.js
- Port: ung dung hien dang dung co dinh `3000`

Truoc khi deploy nen chuyen thong tin database va JWT secret sang bien moi truong thay vi de truc tiep trong code. Neu giu code hien tai, can cap nhat `db.js` theo host/user/password/database cua database production.

Sau khi deploy backend, sua `API_BASE` trong cac file frontend tu `http://localhost:3000` sang URL backend production.

## 12. Commit va push code len GitHub

Kiem tra thay doi:

```bash
git status
```

Them file vao staging:

```bash
git add .
```

Tao commit:

```bash
git commit -m "update README huong dan cai dat va deploy"
```

Push len branch `main`:

```bash
git push origin main
```

Kiem tra log:

```bash
git log --oneline -5
```

Neu push bi loi dang nhap, hay dang nhap GitHub Desktop hoac dung GitHub CLI:

```bash
gh auth login
```

Sau do chay lai:

```bash
git push origin main
```

## 13. Luu y bao mat

- Khong nen commit mat khau database, JWT secret, token API hoac file `.env` len GitHub.
- Nen cau hinh database/JWT bang bien moi truong khi deploy production.
- Nen doi mat khau MySQL production thanh mat khau manh.
- Nen bat HTTPS khi deploy public.
- Nen backup database truoc khi chay migration.

## 14. Lenh thuong dung

```bash
# Cai dependencies
npm install

# Chay backend
npm start

# Chay dev mode
npm run dev

# Kiem tra cu phap
node --check index.js

# Kiem tra git
git status
git log --oneline -5

# Commit va push
git add .
git commit -m "message"
git push origin main
```

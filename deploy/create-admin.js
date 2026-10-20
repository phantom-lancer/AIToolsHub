// Создаёт админский аккаунт для сервера. Запуск:
//   node deploy/create-admin.js <логин> <пароль>
// Если аккаунт уже есть — обновляет пароль и выдаёт права.
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const [, , login, password] = process.argv;

if (!login || !password) {
    console.error('Использование: node deploy/create-admin.js <логин> <пароль>');
    process.exit(1);
}
if (password.length < 8) {
    console.error('Пароль должен быть не короче 8 символов');
    process.exit(1);
}

const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'database.db');
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA busy_timeout=4000');

const hash = bcrypt.hashSync(password, 10);
const found = db.prepare('SELECT id FROM users WHERE username = ?').get(login);

let id;
if (found) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, found.id);
    id = found.id;
    console.log(`Пароль обновлён: ${login}`);
} else {
    id = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)')
        .run(login, login + '@local', hash).lastInsertRowid;
    console.log(`Создан админ: ${login}`);
}

db.prepare('INSERT OR IGNORE INTO admins (user_id) VALUES (?)').run(id);
console.log('Готово. Вход:', login);
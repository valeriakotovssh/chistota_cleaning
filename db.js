const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(path.join(dataDir, 'database.sqlite'));

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function seedIfEmpty(table, rows, insertSql) {
  const count = await getAsync(`SELECT COUNT(*) as total FROM ${table}`);
  if (count.total > 0) return;
  for (const row of rows) await runAsync(insertSql, row);
}

async function initDb() {
  await runAsync(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await runAsync(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    details TEXT NOT NULL,
    includes TEXT NOT NULL,
    base_price INTEGER NOT NULL,
    price_unit TEXT NOT NULL DEFAULT 'за выезд',
    image TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    popularity INTEGER DEFAULT 0
  )`);

  await runAsync(`CREATE TABLE IF NOT EXISTS cleaning_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    service_id INTEGER,
    client_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT NOT NULL,
    area INTEGER NOT NULL,
    rooms INTEGER DEFAULT 1,
    windows INTEGER DEFAULT 0,
    cleaning_date TEXT NOT NULL,
    cleaning_time TEXT NOT NULL,
    urgency TEXT DEFAULT 'standard',
    wishes TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    total_price INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
  )`);

  await runAsync(`CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    service_id INTEGER,
    preferred_date TEXT,
    preferred_time TEXT,
    message TEXT,
    source TEXT DEFAULT 'contact',
    status TEXT DEFAULT 'new',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  const contactColumns = await allAsync('PRAGMA table_info(contact_messages)');
  const contactColumnNames = contactColumns.map((column) => column.name);
  const addContactColumn = async (name, definition) => {
    if (!contactColumnNames.includes(name)) await runAsync(`ALTER TABLE contact_messages ADD COLUMN ${name} ${definition}`);
  };
  await addContactColumn('email', 'TEXT');
  await addContactColumn('service_id', 'INTEGER');
  await addContactColumn('preferred_date', 'TEXT');
  await addContactColumn('preferred_time', 'TEXT');
  await addContactColumn('status', "TEXT DEFAULT 'new'");

  await runAsync(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    author TEXT NOT NULL,
    role TEXT,
    rating INTEGER DEFAULT 5,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  await seedIfEmpty('users', [
    ['Администратор', 'admin@chistota.ru', '+7 495 123-45-67', 'admin123', 'admin', 'Иркутск, ул. Ленина, 18'],
    ['Елена Смирнова', 'elena@mail.ru', '+7 999 999 99 99', 'user123', 'user', 'Иркутск, ул. Байкальская, 120']
  ], `INSERT INTO users (name, email, phone, password, role, address) VALUES (?, ?, ?, ?, ?, ?)`);

  await seedIfEmpty('services', [
    ['general-cleaning', 'Генеральная уборка', 'Дом', 'Комплексное очищение всех поверхностей и труднодоступных мест.', 'Подходит для квартиры, дома или офиса после долгого перерыва в уборке.', 'кухня и санузлы, мебель и поверхности, вынос мелкого мусора, влажная уборка полов', 5000, 'за выезд', '/img/service-deep-cleaning.jpg', 'active', 100],
    ['after-renovation', 'Послестроительная уборка', 'Ремонт', 'Удаление строительной пыли и загрязнений после ремонта.', 'Клинеры убирают пыль со стен, пола, мебели, стекол и подготавливают помещение к заселению.', 'обеспыливание помещений, мытье окон и рам, удаление следов ремонта, подготовка к заселению', 6500, 'за выезд', '/img/service-home-cleaning.jpg', 'active', 90],
    ['maintenance', 'Поддерживающая уборка', 'Дом', 'Быстрый выезд для тех, кто хочет поддерживать порядок без лишних забот.', 'Подходит для регулярной уборки квартиры, когда не нужна глубокая чистка.', 'еженедельный или разовый выезд, быстрый клининг, экосредства по запросу', 2500, 'за выезд', '/img/service-maintenance.png', 'active', 80],
    ['window-cleaning', 'Мойка окон', 'Дом', 'Стекла, рамы, подоконники, витражи и панорамные окна после сезона или ремонта.', 'Можно добавить к любой уборке или заказать отдельно.', 'окна и рамы, подоконники, безопасные средства, аккуратная сушка', 2000, 'за выезд', '/img/service-window-cleaning.png', 'active', 70],
    ['dry-cleaning', 'Химчистка мебели', 'Спецработы', 'Диваны, кресла, матрасы и ковровые покрытия с безопасной профессиональной химией.', 'Подходит для дома, офиса, кафе и салона.', 'оценка ткани, подбор химии, чистка пятен, сушка поверхности', 3800, 'за услугу', '/img/service-dry-cleaning.png', 'active', 60],
    ['office-cleaning', 'Уборка офиса', 'Бизнес', 'Клининг для офисов, магазинов, салонов и кафе по удобному графику.', 'Можно оформить разовую уборку или регулярный график.', 'рабочие места, санузлы, кухня, входная группа', 9000, 'за смену', '/img/services-wide.jpg', 'active', 95],
    ['disinfection', 'Дезинфекция', 'Спецработы', 'Обработка поверхностей, санузлов и рабочих зон сертифицированными средствами.', 'Подходит для квартир, офисов, кафе и учебных помещений.', 'подбор средства, обработка контактных зон, проветривание, рекомендации', 3000, 'за выезд', '/img/service-kitchen-cleaning.png', 'active', 50],
    ['facade-cleaning', 'Мойка фасадов', 'Бизнес', 'Наружная чистка витрин, входных групп и рекламных конструкций.', 'Для магазинов, офисов и заведений с уличными вывесками.', 'витрины, фасадные панели, входные группы, вывески', 7000, 'за выезд', '/img/about-cleaning.jpg', 'active', 40]
  ], `INSERT INTO services (slug, title, category, description, details, includes, base_price, price_unit, image, status, popularity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  await seedIfEmpty('reviews', [
    [null, 'Алексей', 'Владелец кафе', 5, 'Спасибо большое за быструю и качественную работу. Работник был вежливый и сделал всё в срок.', 'approved'],
    [null, 'Вадим', 'Генеральный директор', 5, 'Уборка была выполнена на высоком уровне, каждый уголок офиса был идеально чистым.', 'approved'],
    [null, 'Анна', 'Фрилансер', 5, 'Наш офис сияет чистотой. Обязательно обратимся снова.', 'approved']
  ], `INSERT INTO reviews (user_id, author, role, rating, text, status) VALUES (?, ?, ?, ?, ?, ?)`);

  await seedIfEmpty('cleaning_orders', [
    [2, 1, 'Елена Смирнова', '+7 999 999 99 99', 'elena@mail.ru', 'Иркутск, ул. Байкальская, 120', 74, 3, 4, '2026-05-24', '12:00', 'standard', 'Особое внимание кухне', 'confirmed', 8700],
    [2, 4, 'Елена Смирнова', '+7 999 999 99 99', 'elena@mail.ru', 'Иркутск, ул. Байкальская, 120', 55, 2, 6, '2026-05-27', '15:00', 'standard', 'Помыть окна на балконе', 'new', 4100],
    [2, 3, 'Елена Смирнова', '+7 999 999 99 99', 'elena@mail.ru', 'Иркутск, ул. Байкальская, 120', 45, 2, 0, '2026-04-12', '10:00', 'standard', '', 'completed', 2500],
    [2, 5, 'Елена Смирнова', '+7 999 999 99 99', 'elena@mail.ru', 'Иркутск, ул. Байкальская, 120', 20, 1, 0, '2026-03-28', '11:00', 'standard', 'Диван в гостиной', 'completed', 3800]
  ], `INSERT INTO cleaning_orders (user_id, service_id, client_name, phone, email, address, area, rooms, windows, cleaning_date, cleaning_time, urgency, wishes, status, total_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
}

module.exports = { db, initDb, runAsync, getAsync, allAsync };

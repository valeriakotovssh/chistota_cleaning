const express = require('express');
const session = require('express-session');
const NodeCache = require('node-cache');
const { initDb, runAsync, getAsync, allAsync } = require('./db');

const app = express();
const cache = new NodeCache({ stdTTL: 30 });
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', `${__dirname}/views`);

app.use(express.static(`${__dirname}/public`));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'chistota-course-project-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 2 }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.path = req.path;
  res.locals.success = req.query.success;
  res.locals.error = req.query.error;
  res.locals.statusLabel = statusLabel;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/admin-login?error=admin');
  next();
}

function splitList(value) {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function statusLabel(status) {
  const labels = {
    new: 'Ожидает подтверждения',
    confirmed: 'Подтверждена',
    in_work: 'В работе',
    completed: 'Завершена',
    cancelled: 'Отменена',
    pending: 'На модерации',
    approved: 'Одобрен',
    rejected: 'Отклонён',
    active: 'Активна',
    draft: 'Черновик',
    client: 'Клиент',
    admin: 'Администратор'
  };
  return labels[status] || status;
}

function monthMeta(value) {
  const base = value ? new Date(`${value}-01T00:00:00`) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const pad = (num) => String(num).padStart(2, '0');
  return {
    year,
    month,
    current: `${year}-${pad(month + 1)}`,
    title: first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
    prev: `${new Date(year, month - 1, 1).getFullYear()}-${pad(new Date(year, month - 1, 1).getMonth() + 1)}`,
    next: `${new Date(year, month + 1, 1).getFullYear()}-${pad(new Date(year, month + 1, 1).getMonth() + 1)}`,
    days: Array.from({ length: last.getDate() }, (_, index) => {
      const day = index + 1;
      return {
        day,
        date: `${year}-${pad(month + 1)}-${pad(day)}`
      };
    })
  };
}

function calculatePrice(service, body) {
  const area = Math.max(Number(body.area) || 1, 1);
  const rooms = Math.max(Number(body.rooms) || 1, 1);
  const windows = Math.max(Number(body.windows) || 0, 0);
  let total = Number(service.base_price);

  if (area > 40) total += (area - 40) * 55;
  if (rooms > 2) total += (rooms - 2) * 400;
  if (windows > 0) total += windows * 250;
  if (body.urgency === 'urgent') total *= 1.25;
  if (body.pets === 'on') total += 700;

  return Math.round(total / 100) * 100;
}

async function services() {
  let rows = cache.get('services');
  if (!rows) {
    rows = await allAsync('SELECT * FROM services ORDER BY popularity DESC, id ASC');
    rows = rows.map((service) => ({ ...service, includesList: splitList(service.includes) }));
    cache.set('services', rows);
  }
  return rows;
}

async function approvedReviews() {
  let rows = cache.get('reviews');
  if (!rows) {
    rows = await allAsync("SELECT * FROM reviews WHERE status = 'approved' ORDER BY created_at DESC");
    cache.set('reviews', rows);
  }
  return rows;
}

app.get('/', async (req, res) => {
  const list = await services();
  res.render('home', {
    title: 'Чистота',
    services: list.slice(0, 8),
    reviews: await approvedReviews()
  });
});

app.get('/services', async (req, res) => {
  const category = req.query.category || '';
  const sort = req.query.sort || 'popular';
  let list = await services();

  if (category) list = list.filter((service) => service.category === category);
  if (sort === 'price') list = [...list].sort((a, b) => a.base_price - b.base_price);

  res.render('services', { title: 'Услуги', services: list, filters: { category, sort } });
});

app.get('/services/:slug', async (req, res) => {
  const service = await getAsync('SELECT * FROM services WHERE slug = ?', [req.params.slug]);
  if (!service) return res.status(404).render('404', { title: 'Страница не найдена' });
  res.render('service', {
    title: service.title,
    service: { ...service, includesList: splitList(service.includes) }
  });
});

app.get('/calculator', async (req, res) => {
  res.render('calculator', { title: 'Расчёт стоимости', services: await services(), form: req.query });
});

app.post('/calculator', async (req, res) => {
  const service = await getAsync('SELECT * FROM services WHERE id = ?', [req.body.service_id]);
  if (!service) return res.redirect('/calculator?error=form');
  const total = calculatePrice(service, req.body);
  res.render('calculator', {
    title: 'Расчёт стоимости',
    services: await services(),
    result: { total, service },
    form: req.body
  });
});

app.post('/orders', async (req, res) => {
  const service = await getAsync('SELECT * FROM services WHERE id = ?', [req.body.service_id]);
  if (!service || !req.body.client_name || !req.body.phone || !req.body.address || !req.body.cleaning_date || !req.body.cleaning_time) {
    return res.redirect('/calculator?error=form');
  }
  const total = calculatePrice(service, req.body);
  await runAsync(
    `INSERT INTO cleaning_orders
     (user_id, service_id, client_name, phone, email, address, area, rooms, windows, cleaning_date, cleaning_time, urgency, wishes, status, total_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.session.user?.id || null,
      service.id,
      req.body.client_name,
      req.body.phone,
      req.body.email || '',
      req.body.address,
      Number(req.body.area) || 1,
      Number(req.body.rooms) || 1,
      Number(req.body.windows) || 0,
      req.body.cleaning_date,
      req.body.cleaning_time,
      req.body.urgency || 'standard',
      req.body.wishes || '',
      'new',
      total
    ]
  );
  cache.del('orders');
  res.redirect('/account?success=order');
});

app.get('/projects', (req, res) => res.redirect('/about'));
app.get('/about', (req, res) => res.render('about', { title: 'О компании' }));

app.get('/contacts', (req, res) => res.render('contacts', { title: 'Контакты' }));

app.post('/contact', async (req, res) => {
  const { name, phone, email = '', service_id = null, preferred_date = '', preferred_time = '', message = '', source = 'contact' } = req.body;
  if (!name || !phone) return res.redirect(`${req.get('referer') || '/contacts'}?error=form`);
  await runAsync(
    `INSERT INTO contact_messages (name, phone, email, service_id, preferred_date, preferred_time, message, source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, phone, email, service_id || null, preferred_date, preferred_time, message, source, 'new']
  );
  res.redirect(`${req.get('referer') || '/contacts'}?success=message`);
});

app.get('/reviews', async (req, res) => {
  res.render('reviews', { title: 'Отзывы', reviews: await approvedReviews() });
});

app.post('/reviews', async (req, res) => {
  const { author, role = 'Клиент', rating = 5, text } = req.body;
  if (!author || !text) return res.redirect('/reviews?error=form');
  await runAsync(
    'INSERT INTO reviews (user_id, author, role, rating, text, status) VALUES (?, ?, ?, ?, ?, ?)',
    [req.session.user?.id || null, author, role, Math.min(Number(rating) || 5, 5), text, 'pending']
  );
  cache.del('reviews');
  res.redirect('/reviews?success=review');
});

app.get('/login', (req, res) => res.render('login', { title: 'Вход в аккаунт' }));

app.post('/login', async (req, res) => {
  if (!req.body.email || !req.body.password) return res.redirect('/login?error=form');
  const user = await getAsync('SELECT * FROM users WHERE email = ? AND password = ?', [req.body.email, req.body.password]);
  if (!user) return res.redirect('/login?error=login');
  if (user.role === 'admin') return res.redirect('/login?error=admin');
  req.session.user = { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, address: user.address };
  res.redirect('/account');
});

app.get('/admin-login', (req, res) => res.render('admin-login', { title: 'Вход администратора' }));

app.post('/admin-login', async (req, res) => {
  if (!req.body.email || !req.body.password) return res.redirect('/admin-login?error=form');
  const user = await getAsync('SELECT * FROM users WHERE email = ? AND password = ?', [req.body.email, req.body.password]);
  if (!user) return res.redirect('/admin-login?error=login');
  if (user.role !== 'admin') return res.redirect('/admin-login?error=admin');
  req.session.user = { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, address: user.address };
  res.redirect('/admin');
});

app.post('/register', async (req, res) => {
  const { name, email, phone, password, address = '' } = req.body;
  if (!name || !email || !password) return res.redirect('/login?error=form');
  try {
    const result = await runAsync(
      'INSERT INTO users (name, email, phone, password, role, address) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, phone, password, 'user', address]
    );
    req.session.user = { id: result.lastID, name, email, phone, role: 'user', address };
    res.redirect('/account');
  } catch (err) {
    res.redirect('/login?error=exists');
  }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/account', requireAuth, async (req, res) => {
  if (req.session.user.role === 'admin') return res.redirect('/admin');
  const today = new Date().toISOString().slice(0, 10);
  const active = await allAsync(
    `SELECT cleaning_orders.*, services.title FROM cleaning_orders
     JOIN services ON services.id = cleaning_orders.service_id
     WHERE cleaning_orders.user_id = ? AND cleaning_orders.cleaning_date >= ?
     ORDER BY cleaning_orders.cleaning_date ASC`,
    [req.session.user.id, today]
  );
  const history = await allAsync(
    `SELECT cleaning_orders.*, services.title FROM cleaning_orders
     JOIN services ON services.id = cleaning_orders.service_id
     WHERE cleaning_orders.user_id = ? AND cleaning_orders.cleaning_date < ?
     ORDER BY cleaning_orders.cleaning_date DESC`,
    [req.session.user.id, today]
  );
  res.render('account', { title: 'Личный кабинет', active, history, services: await services() });
});

app.post('/account/profile', requireAuth, async (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email) return res.redirect('/account?error=form');
  await runAsync('UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?', [name, email, phone || '', req.session.user.id]);
  req.session.user = { ...req.session.user, name, email, phone };
  res.redirect('/account?success=profile');
});

app.get('/admin', requireAdmin, async (req, res) => {
  const stats = {
    services: (await getAsync('SELECT COUNT(*) as total FROM services')).total,
    orders: (await getAsync('SELECT COUNT(*) as total FROM cleaning_orders')).total,
    reviews: (await getAsync("SELECT COUNT(*) as total FROM reviews WHERE status = 'pending'")).total,
    users: (await getAsync("SELECT COUNT(*) as total FROM users WHERE role = 'user'")).total
  };
  const orders = await allAsync(
    `SELECT cleaning_orders.*, services.title FROM cleaning_orders
     JOIN services ON services.id = cleaning_orders.service_id
     ORDER BY cleaning_orders.created_at DESC LIMIT 5`
  );
  res.render('admin-dashboard', { title: 'Админка', stats, orders });
});

app.get('/admin/services', requireAdmin, async (req, res) => {
  const list = await allAsync('SELECT * FROM services ORDER BY id ASC');
  const edit = req.query.edit ? await getAsync('SELECT * FROM services WHERE id = ?', [req.query.edit]) : null;
  res.render('admin-services', { title: 'Админка: услуги', services: list, edit });
});

app.post('/admin/services', requireAdmin, async (req, res) => {
  const { id, title, category, base_price, description, includes, status = 'active' } = req.body;
  if (id) {
    await runAsync(
      'UPDATE services SET title = ?, category = ?, base_price = ?, description = ?, includes = ?, status = ? WHERE id = ?',
      [title, category, Number(base_price), description, includes, status, id]
    );
  } else {
    const slug = title.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '');
    await runAsync(
      'INSERT INTO services (slug, title, category, description, details, includes, base_price, image, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [slug, title, category, description, description, includes, Number(base_price), '/img/service-deep-cleaning.jpg', status]
    );
  }
  cache.del('services');
  res.redirect('/admin/services?success=service');
});

app.post('/admin/services/:id/delete', requireAdmin, async (req, res) => {
  await runAsync('DELETE FROM services WHERE id = ?', [req.params.id]);
  cache.del('services');
  res.redirect('/admin/services');
});

app.get('/admin/orders', requireAdmin, async (req, res) => {
  const orders = await allAsync(
    `SELECT cleaning_orders.*, services.title FROM cleaning_orders
     JOIN services ON services.id = cleaning_orders.service_id
     ORDER BY cleaning_orders.cleaning_date DESC`
  );
  const simpleRequests = await allAsync(
    `SELECT contact_messages.*, services.title AS service_title
     FROM contact_messages
     LEFT JOIN services ON services.id = contact_messages.service_id
     ORDER BY contact_messages.created_at DESC`
  );
  res.render('admin-orders', { title: 'Заявки', orders, simpleRequests, services: await services() });
});

app.post('/admin/requests/:id', requireAdmin, async (req, res) => {
  await runAsync(
    'UPDATE contact_messages SET preferred_date = ?, preferred_time = ?, status = ?, message = ? WHERE id = ?',
    [req.body.preferred_date || '', req.body.preferred_time || '', req.body.status || 'new', req.body.message || '', req.params.id]
  );
  res.redirect('/admin/orders?success=request');
});

app.post('/admin/requests/:id/delete', requireAdmin, async (req, res) => {
  await runAsync('DELETE FROM contact_messages WHERE id = ?', [req.params.id]);
  res.redirect('/admin/orders');
});

app.post('/admin/orders/:id', requireAdmin, async (req, res) => {
  await runAsync(
    'UPDATE cleaning_orders SET cleaning_date = ?, cleaning_time = ?, status = ?, wishes = ? WHERE id = ?',
    [req.body.cleaning_date, req.body.cleaning_time, req.body.status, req.body.wishes || '', req.params.id]
  );
  res.redirect('/admin/orders?success=order');
});

app.post('/admin/orders/:id/delete', requireAdmin, async (req, res) => {
  await runAsync('DELETE FROM cleaning_orders WHERE id = ?', [req.params.id]);
  res.redirect('/admin/orders');
});

app.get('/admin/reviews', requireAdmin, async (req, res) => {
  const reviews = await allAsync('SELECT * FROM reviews ORDER BY created_at DESC');
  res.render('admin-reviews', { title: 'Отзывы', reviews });
});

app.post('/admin/reviews/:id', requireAdmin, async (req, res) => {
  await runAsync('UPDATE reviews SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
  cache.del('reviews');
  res.redirect('/admin/reviews');
});

app.post('/admin/reviews/:id/delete', requireAdmin, async (req, res) => {
  await runAsync('DELETE FROM reviews WHERE id = ?', [req.params.id]);
  cache.del('reviews');
  res.redirect('/admin/reviews');
});

app.get('/admin/calendar', requireAdmin, async (req, res) => {
  const month = monthMeta(req.query.month);
  const orders = await allAsync(
    `SELECT cleaning_orders.*, services.title FROM cleaning_orders
     JOIN services ON services.id = cleaning_orders.service_id
     WHERE cleaning_orders.status != 'cancelled'
       AND cleaning_orders.cleaning_date LIKE ?
     ORDER BY cleaning_orders.cleaning_date ASC, cleaning_orders.cleaning_time ASC`,
    [`${month.current}%`]
  );
  res.render('admin-calendar', { title: 'Календарь', orders, month, services: await services() });
});

app.use((req, res) => res.status(404).render('404', { title: 'Страница не найдена' }));

initDb().then(() => {
  app.listen(PORT, () => console.log(`Chistota started on http://localhost:${PORT}`));
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

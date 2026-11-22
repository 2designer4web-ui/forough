const get = (id) => document.getElementById(id);
const loginForm = get('login-form');
const editor = get('editor-form');
const messages = get('messages');
const notice = get('notice');
let draft;
let revision = 0;
let nextMessage;

const errors = {
  setup_required: 'پنل هنوز فعال نشده است. اتصال پایگاه داده و رمز مدیریت را در Cloudflare تنظیم کنید.',
  bad_login: 'نام کاربری یا رمز عبور درست نیست.',
  unauthorized: 'نشست شما پایان یافته است. دوباره وارد شوید.',
  rate_limit: 'تعداد تلاش‌ها زیاد است. چند دقیقهٔ دیگر دوباره امتحان کنید.',
  conflict: 'نسخهٔ دیگری از محتوا منتشر شده است. پیش از تازه‌سازی صفحه، متن تغییرات خود را بردارید.',
  invalid_request: 'بعضی از فیلدها معتبر نیستند. طول متن‌ها، ایمیل و نشانی تصاویر و پروژه‌ها را بررسی کنید.'
};

function status(text = '', error = false) {
  notice.textContent = text;
  notice.dataset.error = String(error);
}

async function request(path, method = 'GET', data) {
  const options = { method, signal: AbortSignal.timeout(12000) };
  if (data !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(data);
  }
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(errors[payload.error] || 'ارتباط با پنل کامل نشد. دوباره تلاش کنید.');
    error.code = payload.error;
    throw error;
  }
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    const error = new Error(errors.setup_required);
    error.code = 'setup_required';
    throw error;
  }
  return payload;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, action) {
  const node = element('button', text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function field(label, value, change, { max = 150, multiline = false, english = false, required = false } = {}) {
  const wrapper = element('label', label);
  const input = element(multiline ? 'textarea' : 'input');
  input.value = value || '';
  input.maxLength = max;
  input.required = required;
  if (multiline) input.rows = 3;
  if (english) input.dir = 'ltr';
  input.addEventListener('input', () => change(input.value));
  wrapper.append(input);
  return wrapper;
}

function property(label, target, key, options) {
  return field(label, target[key], (value) => { target[key] = value; }, options);
}

function section(title, open = false) {
  const details = element('details');
  details.open = open;
  details.append(element('summary', title));
  editor.append(details);
  return details;
}

function paired(group, label, key, options) {
  group.append(
    property(label + ' فارسی', draft, key, options),
    property(label + ' انگلیسی', draft.english, key, { ...options, english: true })
  );
}

function repeatRows(sectionNode, primary, translated, label, max, make, fields) {
  const rows = element('div', '', 'rows');
  const add = button('افزودن ' + label, () => {
    const [item, translation] = make();
    primary.push(item);
    translated.push(translation);
    render();
  });
  const render = () => {
    rows.replaceChildren();
    primary.forEach((item, index) => {
      const row = element('div', '', 'row');
      const headline = element('div', '', 'headline');
      headline.append(element('h3', label + ' ' + (index + 1)), button('حذف از فهرست', () => {
        primary.splice(index, 1);
        translated.splice(index, 1);
        render();
      }));
      const group = element('div', '', 'fields');
      for (const control of fields(item, translated[index])) group.append(control);
      row.append(headline, group);
      rows.append(row);
    });
    add.disabled = primary.length >= max;
  };
  sectionNode.append(rows, add);
  render();
}

const sectionFields = [
  ['عنوان بخش اول', 'headline', 220], ['عنوان نمونه‌کارها', 'workTitle', 120],
  ['متن نمونه‌کارها', 'workIntro', 500], ['عنوان فرایند', 'processTitle', 120],
  ['عنوان تیم', 'teamTitle', 120], ['عنوان همکاری', 'contactTitle', 160],
  ['متن همکاری', 'contactIntro', 500]
];

function alignTranslations() {
  draft.english.team = draft.team.map((_, index) => draft.english.team[index] || { name: '', role: '' });
  draft.english.projects = draft.projects.map((_, index) => {
    const item = draft.english.projects[index];
    return typeof item === 'string' ? { name: item, description: '' } : item || { name: '', description: '' };
  });
  for (const locale of [draft, draft.english]) {
    locale.sections ||= {};
    locale.process = Array.from({ length: 4 }, (_, index) => locale.process?.[index] || { title: '', description: '' });
  }
}

function showEditor() {
  alignTranslations();
  editor.replaceChildren();
  const general = section('نام و معرفی استودیو', true);
  const fields = element('div', '', 'fields');
  paired(fields, 'نام استودیو', 'brand', { max: 80, required: true });
  paired(fields, 'عنوان کوتاه', 'tagline', { max: 150, required: true });
  paired(fields, 'معرفی صفحهٔ اول', 'intro', { max: 1500, multiline: true, required: true });
  paired(fields, 'دربارهٔ تیم', 'about', { max: 2000, multiline: true, required: true });
  general.append(fields);

  const contact = section('راه‌های تماس');
  const contactFields = element('div', '', 'fields');
  contactFields.append(
    property('ایمیل کاری', draft, 'email', { max: 254, english: true }),
    property('تلفن', draft, 'phone', { max: 36, english: true })
  );
  paired(contactFields, 'آدرس', 'address', { max: 300 });
  contact.append(contactFields);

  const services = section('نوارهای متحرک');
  const ribbonFields = element('div', '', 'fields');
  for (const [key, label, max] of [['services', 'خدمات', 20], ['steps', 'نوار فرایند', 12]]) {
    for (const locale of [draft, draft.english]) {
      const en = locale === draft.english;
      ribbonFields.append(field(label + (en ? ' انگلیسی' : ' فارسی') + '، هر عبارت در یک خط',
        locale[key].join('\n'), (value) => {
          locale[key] = value.split('\n').map((item) => item.trim()).filter(Boolean);
        }, { max: max * 91, multiline: true, english: en }));
    }
  }
  services.append(ribbonFields);

  const text = section('عنوان‌ها و متن بخش‌ها');
  const copyFields = element('div', '', 'fields');
  for (const [label, key, max] of sectionFields) {
    copyFields.append(
      property(label + ' فارسی', draft.sections, key, { max }),
      property(label + ' انگلیسی', draft.english.sections, key, { max, english: true })
    );
  }
  text.append(element('p', 'فیلد خالی متن پیش‌فرض سایت را نشان می‌دهد.', 'subtle'), copyFields);

  const process = section('چهار مرحلهٔ همکاری');
  draft.process.forEach((step, index) => {
    const row = element('div', '', 'row');
    const translated = draft.english.process[index];
    row.append(element('h3', 'مرحلهٔ ' + (index + 1)));
    const group = element('div', '', 'fields');
    group.append(
      property('عنوان فارسی', step, 'title', { max: 125 }),
      property('عنوان انگلیسی', translated, 'title', { max: 125, english: true }),
      property('متن فارسی', step, 'description', { max: 400, multiline: true }),
      property('متن انگلیسی', translated, 'description', { max: 400, multiline: true, english: true })
    );
    row.append(group);
    process.append(row);
  });

  const team = section('اعضای تیم');
  team.append(element('p', 'برای عکس، نشانی HTTPS یا مسیر یک فایل داخل assets را وارد کنید.', 'subtle'));
  repeatRows(team, draft.team, draft.english.team, 'عضو تیم', 12,
    () => [{ name: '', role: '', image: '' }, { name: '', role: '' }],
    (person, en) => [
      property('نام فارسی', person, 'name', { max: 100, required: true }),
      property('نام انگلیسی', en, 'name', { max: 100, english: true }),
      property('تخصص فارسی', person, 'role', { max: 175, required: true }),
      property('تخصص انگلیسی', en, 'role', { max: 175, english: true }),
      property('نشانی عکس', person, 'image', { max: 500, english: true })
    ]);

  const projects = section('نمونه‌کارها');
  repeatRows(projects, draft.projects, draft.english.projects, 'نمونه‌کار', 30,
    () => [{ name: '', image: '', description: '', url: '' }, { name: '', description: '' }],
    (project, en) => [
      property('عنوان فارسی', project, 'name', { max: 100, required: true }),
      property('عنوان انگلیسی', en, 'name', { max: 100, english: true }),
      property('توضیح فارسی', project, 'description', { max: 1400, multiline: true }),
      property('توضیح انگلیسی', en, 'description', { max: 1400, multiline: true, english: true }),
      property('نشانی تصویر', project, 'image', { max: 500, english: true }),
      property('پیوند پروژه', project, 'url', { max: 500, english: true })
    ]);
  get('publish').disabled = false;
}

function messageCard(item) {
  const card = element('article', '', 'message');
  const header = element('div', '', 'headline');
  const date = new Date(item.created_at);
  const time = element('time', date.toLocaleString('fa-IR'));
  time.dateTime = date.toISOString();
  header.append(element('h3', item.name), time);
  const reply = element('p', item.reply, 'subtle');
  reply.dir = 'auto';
  const body = element('p', item.message);
  body.dir = 'auto';
  const toggle = button(item.handled ? 'بازگرداندن به بررسی' : 'علامت‌گذاری به‌عنوان رسیدگی‌شده', async () => {
    toggle.disabled = true;
    try {
      await request('/api/admin/inquiries/' + item.id, 'PATCH', { handled: !item.handled });
      card.replaceWith(messageCard({ ...item, handled: !item.handled }));
      status('وضعیت پیام به‌روز شد.');
    } catch (error) {
      status(error.message, true);
      toggle.disabled = false;
    }
  });
  card.append(header, reply, body, toggle);
  return card;
}

async function loadInbox(append = false) {
  const query = append && nextMessage ? '?before=' + nextMessage : '';
  get('refresh').disabled = true;
  get('more').disabled = true;
  try {
    const payload = await request('/api/admin/inquiries' + query);
    if (!append) messages.replaceChildren();
    if (!append && !payload.items.length) messages.append(element('p', 'هنوز درخواستی ثبت نشده است.', 'subtle'));
    for (const item of payload.items) messages.append(messageCard(item));
    nextMessage = payload.next;
    get('more').hidden = !nextMessage;
  } catch (error) {
    status(error.message, true);
  } finally {
    get('refresh').disabled = false;
    get('more').disabled = false;
  }
}

async function dashboard() {
  get('login').hidden = true;
  get('dashboard').hidden = false;
  get('logout').hidden = false;
  status();
  get('publish').disabled = true;
  await Promise.all([
    loadInbox(),
    request('/api/site').then((site) => {
      draft = structuredClone(site.content || window.studioContent);
      revision = site.revision;
      showEditor();
    }).catch((error) => status(error.message, true))
  ]);
}

for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => {
    for (const option of document.querySelectorAll('[data-tab]')) {
      option.setAttribute('aria-pressed', String(option === tab));
      get(option.dataset.tab).hidden = option !== tab;
    }
  });
}

get('refresh').addEventListener('click', () => loadInbox());
get('more').addEventListener('click', () => loadInbox(true));

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = loginForm.querySelector('button');
  submit.disabled = true;
  try {
    await request('/api/admin/login', 'POST', Object.fromEntries(new FormData(loginForm)));
    loginForm.reset();
    await dashboard();
  } catch (error) {
    loginForm.elements.password.value = '';
    status(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

get('logout').addEventListener('click', async () => {
  try {
    await request('/api/admin/logout', 'POST', {});
    location.reload();
  } catch (error) {
    status(error.message, true);
  }
});

editor.addEventListener('invalid', (event) => {
  const sectionNode = event.target.closest('details');
  if (sectionNode) sectionNode.open = true;
}, true);

editor.addEventListener('submit', async (event) => {
  event.preventDefault();
  get('publish').disabled = true;
  status('در حال انتشار…');
  try {
    const saved = await request('/api/admin/content', 'PUT', { content: draft, revision });
    revision = saved.revision;
    get('publish-note').textContent = 'نسخهٔ ' + revision.toLocaleString('fa-IR');
    status('تغییرات در سایت منتشر شدند.');
  } catch (error) {
    status(error.message, true);
  } finally {
    get('publish').disabled = false;
  }
});

request('/api/admin/session').then(dashboard).catch((error) => {
  get('login').hidden = false;
  status(error.code === 'unauthorized' ? '' : error.message, error.code !== 'unauthorized');
});

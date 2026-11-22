const studio = window.studioContent;
const isEnglish = document.documentElement.lang === 'en';
const translate = (fa, en) => isEnglish ? en : fa;
const english = studio.english;
const content = isEnglish ? {
  ...studio,
  ...english,
  team: studio.team.map((person, index) => ({ ...person, ...english.team[index] })),
  projects: studio.projects.map((project, index) => ({
    ...project,
    name: english.projects[index] || project.name
  }))
} : studio;
const get = (id) => document.getElementById(id);

document.querySelectorAll('[data-brand]').forEach((brand) => {
  brand.textContent = content.brand;
});
for (const field of ['tagline', 'intro', 'about']) {
  get(field).textContent = content[field];
}
document.title = content.brand + translate(' | استودیو طراحی و توسعه وب', ' | Web Design Studio');

for (const ribbon of document.querySelectorAll('[data-ribbon]')) {
  const words = content[ribbon.dataset.ribbon].filter(Boolean);
  if (!words.length) {
    ribbon.hidden = true;
    continue;
  }
  ribbon.setAttribute('aria-label', words.join(translate('، ', ', ')));
  ribbon.setAttribute('role', 'img');
  const belt = document.createElement('div');
  belt.className = 'belt';
  belt.setAttribute('aria-hidden', 'true');
  const group = document.createElement('div');
  group.className = 'belt-group';
  const addWords = () => {
    for (const word of words) {
      const item = document.createElement('span');
      const star = document.createElement('b');
      star.textContent = '✦';
      item.append(word, star);
      group.append(item);
    }
  };
  addWords();
  belt.append(group);
  ribbon.append(belt);
  const fillBelt = () => {
    if (ribbon.clientWidth === 0 || group.offsetWidth === 0) return;
    const previousLength = group.children.length;
    while (group.offsetWidth < ribbon.clientWidth) addWords();
    if (belt.children.length === 1 || group.children.length !== previousLength) {
      belt.replaceChildren(group, group.cloneNode(true));
    }
  };
  fillBelt();
  new ResizeObserver(fillBelt).observe(ribbon);
  document.fonts.ready.then(fillBelt);
}

const projectDialog = get('project-dialog');
for (const project of content.projects) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'project';
  card.innerHTML = '<span class="browser" aria-hidden="true"><i></i><i></i><i></i></span><img alt="" loading="lazy"><span></span>';
  card.querySelector('img').src = project.image;
  card.lastElementChild.textContent = project.name;
  card.addEventListener('click', () => {
    get('project-image').src = project.image;
    get('project-title').textContent = project.name;
    get('project-description').textContent = project.description || translate('پیش‌نمایش نمونه. توضیح پروژه پس از دریافت اطلاعات تکمیل می‌شود.', 'Sample preview. Project details will be added later.');
    const link = get('project-link');
    link.hidden = !/^https?:\/\//i.test(project.url);
    if (link.hidden) link.removeAttribute('href');
    else link.href = project.url;
    projectDialog.showModal();
  });
  get('projects').append(card);
}

for (const person of content.team) {
  const card = document.createElement('article');
  card.className = 'person-card';
  if (person.image) {
    const portrait = document.createElement('img');
    portrait.className = 'portrait';
    portrait.src = person.image;
    portrait.alt = person.name;
    portrait.loading = 'lazy';
    card.append(portrait);
  } else {
    card.innerHTML = '<div class="portrait" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="31" r="18"/><path d="M13 94v-9a37 37 0 0 1 74 0v9z"/></svg></div>';
  }
  const name = document.createElement('h3');
  const role = document.createElement('p');
  name.textContent = person.name;
  role.textContent = person.role;
  card.append(name, role);
  get('people').append(card);
}

for (const [value, label, protocol] of [
  [content.address, translate('شهر و آدرس استودیو', 'Studio location'), ''],
  [content.email, translate('ایمیل کاری', 'Business email'), 'mailto:'],
  [content.phone, translate('شماره تماس', 'Phone number'), 'tel:']
]) {
  const item = document.createElement(value && protocol ? 'a' : 'span');
  item.textContent = value || '[' + label + ']';
  if (value && protocol) {
    item.href = protocol + value;
    item.dir = 'ltr';
  }
  get('details').append(item);
}

const contactDialog = get('contact-dialog');
get('start').addEventListener('click', () => contactDialog.showModal());
get('contact-help').textContent = content.email
  ? translate('پیش‌نویس درخواست در برنامه ایمیل شما باز می‌شود.', 'Your inquiry opens as a draft in your email app.')
  : translate('پس از تکمیل فرم می‌توانید متن درخواست را کپی کنید. ایمیل استودیو هنوز وارد نشده است.', 'You can copy the completed inquiry. The studio has not added an email address yet.');
get('submit-inquiry').textContent = content.email
  ? translate('باز کردن پیش‌نویس ایمیل', 'Open email draft')
  : translate('آماده‌سازی متن درخواست', 'Prepare inquiry');

get('inquiry').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = [
    translate('نام: ', 'Name: ') + form.get('name'),
    translate('راه تماس: ', 'Contact: ') + form.get('reply'),
    translate('توضیح پروژه:', 'Project details:'),
    form.get('message')
  ].join('\n');
  if (content.email) {
    location.href = 'mailto:' + content.email + '?subject=' + encodeURIComponent(translate('درخواست همکاری', 'Project inquiry')) + '&body=' + encodeURIComponent(body);
    return;
  }
  const draft = get('draft');
  draft.value = body;
  draft.hidden = false;
  try {
    await navigator.clipboard.writeText(body);
    get('form-status').textContent = translate('متن درخواست کپی شد.', 'Inquiry copied.');
  } catch {
    draft.select();
    get('form-status').textContent = translate('متن درخواست آماده کپی است.', 'Your inquiry is ready to copy.');
  }
});

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
}

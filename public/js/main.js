const registerToggle = document.querySelector('[data-toggle-register]');
const registerForm = document.querySelector('.register-form');

if (registerToggle && registerForm) {
  registerToggle.addEventListener('click', () => {
    registerForm.classList.toggle('hidden');
  });
}

const slider = document.querySelector('[data-slider]');
const prevBtn = document.querySelector('[data-slide-prev]');
const nextBtn = document.querySelector('[data-slide-next]');

if (slider && prevBtn && nextBtn) {
  const slide = () => {
    const card = slider.querySelector('.service-card');
    return card ? card.getBoundingClientRect().width + 30 : 430;
  };
  prevBtn.addEventListener('click', () => slider.scrollBy({ left: -slide(), behavior: 'smooth' }));
  nextBtn.addEventListener('click', () => slider.scrollBy({ left: slide(), behavior: 'smooth' }));
}

const calcForm = document.querySelector('[data-calc-form]');
if (calcForm) {
  const serviceSelect = calcForm.querySelector('[data-service-select]');
  const totalNode = calcForm.querySelector('[data-calc-total]');
  const money = new Intl.NumberFormat('ru-RU');

  const countTotal = () => {
    const selected = serviceSelect.options[serviceSelect.selectedIndex];
    const base = Number(selected?.dataset.price || 0);
    const area = Math.max(Number(calcForm.area.value) || 1, 1);
    const rooms = Math.max(Number(calcForm.rooms.value) || 1, 1);
    const windows = Math.max(Number(calcForm.windows.value) || 0, 0);
    let total = base;
    if (area > 40) total += (area - 40) * 55;
    if (rooms > 2) total += (rooms - 2) * 400;
    if (windows > 0) total += windows * 250;
    if (calcForm.urgency.value === 'urgent') total *= 1.25;
    if (calcForm.pets.checked) total += 700;
    total = Math.round(total / 100) * 100;
    totalNode.textContent = `${money.format(total)} ₽`;
  };

  calcForm.querySelectorAll('[data-calc-input], [data-service-select]').forEach((field) => {
    field.addEventListener('input', countTotal);
    field.addEventListener('change', countTotal);
  });
  countTotal();
}

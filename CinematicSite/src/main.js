import './styles.css';

const root = document.documentElement;
const opening = document.querySelector('.opening');
const language = document.querySelector('.language');
const revealItems = document.querySelectorAll('.reveal');
let english = false;

const setLanguage = (useEnglish) => {
  english = useEnglish;
  root.lang = useEnglish ? 'en' : 'ar';
  root.dir = useEnglish ? 'ltr' : 'rtl';
  document.title = useEnglish ? 'FFI Contracting | From Commitment to Completion' : 'FFI للمقاولات | من الالتزام إلى الإنجاز';
  language.textContent = useEnglish ? 'العربية' : 'EN';
  document.querySelectorAll('[data-ar][data-en]').forEach((element) => {
    element.innerHTML = element.dataset[useEnglish ? 'en' : 'ar'];
  });
};

language.addEventListener('click', () => setLanguage(!english));
const dismissOpening = () => opening.classList.add('is-dismissed');
window.addEventListener('scroll', () => {
  if (window.scrollY > 36) dismissOpening();
}, { passive: true });
window.setTimeout(dismissOpening, 2200);
document.querySelector('#year').textContent = new Date().getFullYear();

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('is-visible'));
}, { threshold: 0.16 });
revealItems.forEach((item) => observer.observe(item));

document.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener('click', (event) => {
  const target = document.querySelector(link.getAttribute('href'));
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}));

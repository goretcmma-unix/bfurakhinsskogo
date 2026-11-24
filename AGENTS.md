# Правила проекта

## Переход Hero → Финансы

Источник — `backup_before_fix/public-site/index.html` (строки ~137–196). Брать оттуда, не придумывать новые градиенты и не добавлять отдельные слои.

Текущий `--bg = #0A0D0D` совпадает с фоном `#finances`, поэтому `var(--bg)` в градиентах работает без полосы.

```css
.hero-visual {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
.hero-image-wrap {
  position: absolute;
  inset: 0;
  -webkit-mask-image:
    linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 28%, rgba(0,0,0,0.92) 42%, rgba(0,0,0,0.55) 58%, rgba(0,0,0,0.18) 74%, rgba(0,0,0,0) 100%),
    linear-gradient(to top, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 22%, rgba(0,0,0,1) 100%);
  -webkit-mask-composite: source-in;
  mask-image:
    linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 28%, rgba(0,0,0,0.92) 42%, rgba(0,0,0,0.55) 58%, rgba(0,0,0,0.18) 74%, rgba(0,0,0,0) 100%),
    linear-gradient(to top, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 22%, rgba(0,0,0,1) 100%);
  mask-composite: intersect;
}
.hero-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 18% center;
  display: block;
  filter: contrast(1.03) saturate(0.98);
}
.hero-visual::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to right, rgba(11,13,13,0) 0%, rgba(11,13,13,0) 22%, rgba(11,13,13,0.06) 40%, rgba(11,13,13,0.22) 58%, rgba(11,13,13,0.55) 76%, rgba(11,13,13,0.88) 90%, var(--bg) 100%),
    linear-gradient(to top, var(--bg) 0%, rgba(11,13,13,0.72) 14%, rgba(11,13,13,0) 38%);
  pointer-events: none;
}
```

Медиа-переопределения тоже из бекапа:

- `max-width: 1024px`: свои `mask-image` и два градиента (`to bottom` + `to right`);
- `max-width: 640px`: один градиент `to bottom` с `var(--bg)` на конце.

### Не менять

1. Не добавлять `hero-fade`, шум/дизеринг, многоступенчатые кривые и другие «улучшения» — всё это уже ломало переход.
2. Не перезаписывать `background` в `.hero-visual::after` — правый и нижний слои идут через запятую в одном объявлении.
3. Не трогать изумрудные радиальные градиенты в `.hero-bg`.

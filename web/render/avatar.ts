/** Буквы и цифры любого алфавита: имена в истории бывают не только латиницей. */
const LETTER = /\p{L}|\p{N}/u;

function firstLetter(text: string): string {
  for (const char of text) {
    if (LETTER.test(char)) return char.toUpperCase();
  }
  return '';
}

/**
 * Одна-две буквы для значка автора. Имя может быть пустым или состоять из
 * знаков — тогда отступаем к почте, а если и её нет, показываем вопрос:
 * пустой кружок читался бы как ошибка отрисовки.
 */
export function initialsFor(name: string, email: string): string {
  const words = name.split(/[\s.,;:<>()"'|/\\]+/u).filter((word) => LETTER.test(word));
  const letters = words.slice(0, 2).map(firstLetter).join('');
  if (letters.length > 0) return letters;

  const fromEmail = firstLetter(email);
  return fromEmail.length > 0 ? fromEmail : '?';
}

/**
 * Цвет значка выводится из почты, а не из имени: один человек пишет имя
 * по-разному, а почта — тот же ключ, по которому авторы дедуплицируются при
 * сборке пакета, и приводится он так же.
 *
 * Насыщенность и светлота фиксированы: значки должны читаться поверх тёмной
 * сцены и не сливаться с пастельной палитрой узлов.
 */
export function avatarColor(email: string): string {
  const key = email.trim().toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  }
  const hue = (hash >>> 0) % 360;
  return `hsl(${hue} 70% 66%)`;
}

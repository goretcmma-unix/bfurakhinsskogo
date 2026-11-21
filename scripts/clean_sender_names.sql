-- Очистка sender_name в public.transactions: "ПАО//Сбербанк МАГОМЕДОВ Э...//36000703" -> "МАГОМЕДОВ Э.М"
-- Формат: ФАМИЛИЯ И.О (фамилия заглавными + инициалы имени и отчества)

-- ===== ШАГ 1: предварительный просмотр (запустите primero) =====
WITH cleaned AS (
  SELECT
    id,
    sender_name as old_name,
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(sender_name, '\d+', ' ', 'g'),
            '(^|\s)(пао|ао|ооо|зао|ип|ltd|llc|inc|банк|банке|банка)(\s|$)',
            ' ', 'gi'
          ),
          '[/]+', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ) as clean_str
  FROM public.transactions
  WHERE sender_name IS NOT NULL AND trim(sender_name) != ''
),
split AS (
  SELECT
    id,
    old_name,
    clean_str,
    string_to_array(clean_str, ' ') as words,
    array_length(string_to_array(clean_str, ' '), 1) as wc
  FROM cleaned
  WHERE clean_str != ''
),
formatted AS (
  SELECT
    id,
    old_name,
    words,
    wc,
    CASE
      WHEN wc = 1 THEN upper(words[1])
      WHEN wc = 2 THEN upper(words[1]) || ' ' || upper(substr(words[2], 1, 1)) || '.'
      WHEN wc = 3 THEN upper(words[1]) || ' ' || upper(substr(words[2], 1, 1)) || '. ' || upper(substr(words[3], 1, 1)) || '.'
      WHEN wc >= 4 THEN
        upper(words[wc-2]) || ' ' || upper(substr(words[wc-1], 1, 1)) || '. ' || upper(substr(words[wc], 1, 1)) || '.'
      ELSE NULL
    END as new_name
  FROM split
)
SELECT id, old_name, new_name
FROM formatted
WHERE new_name IS NOT NULL AND old_name IS DISTINCT FROM new_name
ORDER BY id;

-- ===== ШАГ 2: обновление (запустите после просмотра) =====
-- WITH cleaned AS (...)
-- UPDATE public.transactions t SET sender_name = f.new_name, updated_at = now()
-- FROM formatted f WHERE t.id = f.id AND f.new_name IS NOT NULL AND t.sender_name IS DISTINCT FROM f.new_name;

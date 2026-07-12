## מטרה
לוודא ש-"עבד ממתינים" באמת מרים את כל 655 המסמכים ולהוסיף מדד התקדמות חי עם פירוט הצלחות/שגיאות/לא נתמכים.

## שינויים ב-`src/routes/_authenticated/knowledge.tsx`

### 1. אימות שהרשימה מלאה לפני התחלה (`processPending`)
- לפני קריאה ל-`runBatch`, אם `docsQuery.isLoading` או `isFetching` — `toast.info("הרשימה עדיין נטענת, נסה שוב בעוד רגע")` ולצאת.
- `console.log("[processPending] pending count:", list.length, "total loaded:", docsQuery.data?.length)` — כדי לראות ב-DevTools שבאמת נטענו 655.
- אם `list.length === 0` וה-total גם 0 → toast עם הודעה ברורה שלא נטענו מסמכים (כרגע רק "אין מסמכים לעיבוד" — מטעה כשהרשימה עוד לא נטענה).
- `refetch()` מפורש לפני איסוף הרשימה כדי להבטיח מצב עדכני.

### 2. מונים חיים של תוצאות
מרחיב את `batchState` מ-`{done, total}` ל:
```ts
{ done: number; total: number; ok: number; failed: number; unsupported: number }
```
- ב-`runProcess` (או דרך invalidate + הצצה בנתונים החדשים): לא אמין. במקום זאת — קורא ל-`runProcess` שמחזיר את הסטטוס החדש (`processed`/`error`/`unsupported`). כרגע `runProcess` לא מחזיר כלום — אעדכן אותו להחזיר `{status}` על סמך `processing_status` שנקרא מ-DB אחרי הקריאה, או פשוט אקרא ל-`supabase.from('documents').select('processing_status').eq('id', docId).single()` מיד אחרי `invoke`.
- אחרי כל doc, מגדיל `done` ואחד מ-`ok/failed/unsupported`.

### 3. תצוגת ההתקדמות בכפתור/באזור header
במקום השורה הקצרה הנוכחית, אחרי הכפתורים אציג שורת סטטוס כשה-batch רץ:
```
מעבד ממתינים: 47 / 655  •  ✓ 42 הצליחו  •  ✗ 3 נכשלו  •  ⓘ 2 לא נתמכים
```
- Badge/pill קטן ברקע slate `#294550/10` עם טקסט slate + מספרי הצלחה בירוק, כשלים באדום, לא-נתמכים באמבר.
- הכפתור עצמו נשאר עם הספינר והמונה הקצר כמו היום.
- RTL, פונט קיים.

### 4. Preflight: לוודא שאין תקרת שליפה מסתירה pending
- `listDocuments` כבר מפעיל paginate loop של 1000 (מבדק קיים). לא נוגעים בזה.
- מוסיף `console.log` חד-פעמי ב-`processPending` שמדפיס כמה pending מזוהים, כדי שנוכל לאמת לפני שמריצים 655 קריאות.

## מה **לא** משתנה
- `supabase/functions/process-document/index.ts` — אין נגיעה.
- `supabase/functions/ask-assistant/index.ts` — אין נגיעה.
- לוגיקת extraction/embedding/chunking — לא נוגעים.
- concurrency נשאר 3.
- `listDocuments` נשאר עם ה-pagination הקיים.

## אימות אחרי build
1. פותחים את `/knowledge`.
2. פותחים DevTools → Console.
3. לוחצים "עבד ממתינים".
4. מוודאים שה-console מדפיס `pending count: 655`.
5. מוודאים שרואים את שורת ההתקדמות עם מונה שעולה + פירוט הצלחות/שגיאות.
6. מוודאים ב-Network שיש קריאות `process-document` יוצאות בקצב של ~3 במקביל.

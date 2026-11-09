# ListSnap: a photo of a list → Excel

Take a photo of a list (item, quantity, price, morning/afternoon, made). ListSnap reads it and puts it in a table you can edit. You can then save it as a **new Excel file** or **add the rows to an Excel file you already have**. It works on phone and PC. When you sign in with Google, your files are kept in your Google Drive, so every device sees the same files.

- **Free text reading (OCR)** with Tesseract. It runs on your own device, so photos aren't uploaded anywhere.
- **Optional: read with Claude or Gemini** for printed forms, Amharic and handwriting. Much more accurate, but the photo is sent to that company (see below). Gemini works with a free key.
- **Your own columns**: add, rename or delete columns and rows. Save column setups as templates (for example "Bakery morning list").
- **Add to an existing file**: pick the file and the tab, or create a new tab for a new list. Columns are matched by name, missing columns are added on the right, and your file's formulas, prices, Total row and formatting keep working (see "Adding to an Excel file you already have").
- **Works without an account**: files are downloaded to and opened from the device.

## Use it on this PC now
Double-click **`Start ListSnap.bat`**. It opens http://localhost:8080. Keep the black window open while you use it.

Without Google set up, everything works except sync. "Save" downloads the `.xlsx` file, and "Open from device" lets you add rows to an Excel file you already have.

## Turn on Google sign-in and sync (one time, about 10 minutes, free)
1. Go to https://console.cloud.google.com and create a project (any name, e.g. "ListSnap").
2. **APIs & Services → Library**: search for **Google Drive API** and click **Enable**.
3. **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"):
   - User type **External**, app name "ListSnap", and your email.
   - Under **Audience / Test users**, add your Google email, plus the email of anyone else who will use it.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**: add `http://localhost:8080` and your web address from the next section (e.g. `https://YOURNAME.github.io`).
5. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`) and paste it into `config.js`:
   ```js
   GOOGLE_CLIENT_ID: "1234-abc.apps.googleusercontent.com",
   ```

ListSnap only asks for the `drive.file` permission. It can see only the files it created itself, and it keeps them in a **ListSnap** folder in your Drive.

## Put it online so your phone can use it (free, GitHub Pages)
Phones need an `https://` address for Google sign-in.
1. Create a free account at https://github.com and make a new **public** repository called `listsnap`.
2. Upload every file in this folder (drag them onto the repository page, then click "Commit").
3. Go to the repository's **Settings → Pages**. Set Source to "Deploy from a branch" and Branch to `main` / root, then click Save.
4. After a minute your app is at `https://YOURNAME.github.io/listsnap/`. Add `https://YOURNAME.github.io` to the Authorized JavaScript origins (step 4 above).
5. On your phone, open that address and choose **Add to Home screen** (Android: ⋮ menu; iPhone: Share button). It then opens like an app.

## Columns come from the picture
With **"Use the columns from the picture"** ticked (the default):
- **The picture has a header row** (e.g. `Product  Unit  Qty  Price  Supplier`, or `ዕቃ  ብዛት  ዋጋ  ደንበኛ`): those become the table's columns, with the same names. Every value goes under the header it lines up with in the photo. Number columns become numbers, ✓/–/yes/no columns become checkboxes, and morning/afternoon columns become the Time dropdown.
- **No header row:** the table only gets the columns the list actually has. A list of "Eggs 12" lines gives just Item and Qty, with no empty Price, Time or Made columns.
- A line with just "Morning"/"ጠዋት" or "Afternoon"/"ከሰዓት በኋላ" fills a Time column. If the header has no Time column, one is added.
- **Tables with lines** (a screenshot of Excel or Google Sheets, or a printed table with borders): the lines show where each cell is, so long text that wraps onto several lines inside a cell stays one row. The spreadsheet's A B C letters and 1 2 3 row numbers are left out.
- **Small text** (screenshots, or a list photographed from far away) is read a second time at a bigger size, which takes a few seconds longer.
- **Scanning another page of the same table** adds its rows underneath. Columns are matched by their exact names, and any new ones are added on the right.
- **Scanning a picture whose header is different from the table on screen** starts a new table with the picture's own columns, so they're never renamed to Item, Qty and so on. The earlier rows are put aside, and the **Undo** button in the message brings them back.
- A list **without** a header row gets ListSnap's own names (Item, Qty…). Those are matched by meaning too, so its Qty goes into a "ብዛት" column if your table has one.

Untick it to always use your own columns or a saved template instead.

## Tips for good scans
- Hold the phone straight above the page, with good light and no shadows. Fill the frame with the list.
- Put one item per line. A layout like `Bread 12 $3.50 morning made` works best.
- A line that is only `Morning` or `Afternoon` sets that time for the lines under it.
- Printed or typed lists read well. Handwriting is often only partly right, so always check the table before saving.
- The text the scanner read is shown under "Text the scanner read", in case you need to compare.

## Amharic (አማርኛ) lists
- Choose **Amharic** under Language. If the list mixes Amharic and English words, choose **Amharic + English**. The first scan downloads the Amharic reading data once (it needs internet), and after that it works offline.
- ListSnap understands **ጠዋት / ማለዳ** (morning) and **ከሰዓት በኋላ** (afternoon). These work on their own line as a section title too.
- **ተሰርቷል, ተሠራ, ተዘጋጅቷል, ዝግጁ** mark the row as Made.
- Prices with **ብር** ("30 ብር" or "ብር 30"), and units like **ኪሎ, ሊትር, ፍሬ, ካርቶን, ፓኬት**.
- **Ethiopic numerals** (፲፪ = 12, ፪፻፶ = 250) are turned into ordinary numbers for Excel.
- Amharic letters that look alike are sometimes swapped (for example ስኳር read as ስኪር), so check item names before saving.

## Read with an AI: Claude or Gemini (optional, more accurate)
The free reader does well on clear, printed lists. For forms with many columns and lines, Amharic, or handwriting, choose **Claude** or **Gemini** in the **Reader** menu under the Read list button.

Both copy the picture's own columns. A two-row header becomes "Group: Sub" names, for example `ጠዋት የተሰራ: ያደረ`. They fill in handwritten numbers too. Check the table before saving. Reading takes up to a minute.

| | Claude (Anthropic) | Gemini (Google) |
|---|---|---|
| Key | https://console.anthropic.com → Settings → API keys. Add a little credit (a few dollars lasts a long time). | https://aistudio.google.com/app/apikey → Get API key. A free key works. |
| Cost per photo | About 2–10 US cents, depending on the table's size | **Free key:** nothing, but only about 20 requests a day per model (the limit found in November 2026), and each read or Proofread is one request. **Paid key:** about 1–3 US cents. |
| Your photos | Sent to Anthropic. By default, API data isn't used to train its models. | Sent to Google. **With a free key, Google may use them to improve its products** (people may read them). Paid keys: not used. |
| Model | Claude Opus 5.5. If a request is ever declined, it's retried on another Claude model. | Gemini 3.8 Flash. If it's busy or its daily allowance is used up, ListSnap switches to Gemini 3.6 Flash by itself. |

- ListSnap asks for the key the first time you pick that reader. It's saved only on that phone or computer, so each device asks once. The **API key** button next to the menu changes or removes it.
- **Never put a key in `config.js` or any file you upload.** Anyone could copy it from your website and use your credit. Everyone types their own key into the app.

## Columns worked out with an equation
Press **+ Column**, give it a name such as `Total sales`, and choose **Calculated (equation)** as the type. Tap the columns and signs to build the equation, for example:

`([ጠዋት የተሰራ: ድምር] − [ጠዋት የተሰራ: የተበላሸ]) × [Price]`

- You can also type it: `+ - * /` or `× ÷`, brackets, plain numbers and percentages (`[Price] × 15%`). The line under the buttons shows the result for the first row, or what's wrong.
- **In the table** it recalculates as you edit. A blank cell counts as 0. A **?** means a cell holds words instead of a number; hold the pointer on it to see which.
- **In Excel** it's saved as a real formula, so it keeps working when you change numbers there. A division by an empty cell stays empty instead of showing `#DIV/0!`.
- **Adding to an existing file:** if the column is new to the sheet, it's also worked out for the rows already there, and a Total row gets a SUM for it (except for divisions, where adding up makes no sense). If the sheet already has a formula in that column, the sheet's formula is kept.
- **It stays for the next scan.** After you clear the table and read another sheet, the equation column stays, along with columns you added by hand that it uses, like `Price`. It only goes away if the new picture has none of the columns it uses, which means it's a different form. A Price left empty is filled from that bread's last row when you add to an existing file. **Save as template** keeps equations too.
- Renaming a column updates the equations that use it. A column that an equation uses can't be deleted until you change that equation.

## Remembered names (fewer misread names)
Claude and Gemini misread many printed Amharic names: in a test on the bakery form, Gemini got 21 of 38 wrong (ፒታ became "ፒዛ", ሳንቡሳ became "ሳንድዊች"). Telling it the right names took that to **none**, at the same speed.
- **After you save,** ListSnap offers to **Remember** the names in the table. Correct any misread names before saving, because the list is what Claude and Gemini will copy.
- **Next time,** the names are given to Claude or Gemini while reading. Any name in the table that isn't on your list is marked 🟨 "not on your list", with every reader, so a misread name stands out.
- **Tap a 🟨 name** (or press **Next**) and the bar above the table offers the 3 closest names from your list: tap one to use it, and its price fills in if you have a price list. **+ Add “…” to my names** is there for a bread that's really new. The choices follow what you type. Amharic letters that differ only in their vowel (ዳ/ዶ) count as close, because that's the most common misread: on the real misreads from testing, the right name came first 55 times out of 57.
- **"Use my … remembered names"** under the Reader menu turns this off, for when you scan a different kind of list.
- **Edit names** shows the list, one name per line, in the form's order. Fix or delete names there, or add the table's names with **+ Add the names in the table**.
- **Keep it correct.** The AI follows the list even over the photo: in testing, a wrong name on the list was copied instead of what the photo said. If a printed name on your form changes, change it here too.
- The list is saved on each device separately.

## A Price column that fills itself in
Press **+ Column**, name it `Price`, and choose **Price list (filled in by name)** as the type. Write one line per item:

```
ባለ 10 = 10
ብስኩት = 45
ዳቦ ዱቄት 1 ኪሎ = 95
```

- **+ Add the names in the table** writes every bread name in the table into the list, so you only type the prices.
- Each row gets the price of the name its bread type (the item column) **starts with**, as a whole word. If two names fit, the longer one wins: `ዳቦ ዱቄት 1 ኪሎ` gets 95 even if there's also a `ዳቦ` line, and `ዳቦ` alone covers every other name starting with ዳቦ.
- A row with no matching name is marked 🟨 "without a price". Usually that means a misread name: correct it in the table and the price appears. Or add the name to the list.
- Prices like `95 ብር` or `1,200.50` are fine, and so is a list pasted from Excel (name and price in two columns).
- **Equations can use it**, for example `([ጠዋት የተሰራ: ድምር] + [ከሰዓት የተሰራ: ድምር]) × [Price]`. A row without a price counts as 0.
- **It stays for the next scan**, and **Save as template** keeps the list. Edit the column to change a price.
- **In Excel** the prices are saved as plain numbers. Adding to an existing file that has no Price column yet also fills in prices for the rows already there, matched by their names.
- To change one row's price by hand, edit the column and switch its type to **Number**: the prices stay in the cells and become editable (they stop following the list).

## Checking the table (fewer mistakes)
No reader is perfect, so ListSnap points you at the cells most likely to be wrong. A bar above the table counts them, and **Next** jumps from one to the next.
- 🟥 **Red: the row doesn't add up.** Where a table has a total column (`ያደረ + አዲስ የተመረተ = ድምር`, or `Qty × Price = Total`), ListSnap checks each row, for free and with any reader. It only uses a rule if most rows in the table follow it. A red row may be a misread number or a mistake on the paper itself.
- 🟨 **Yellow: hard to read.** With Claude or Gemini, the AI marks cells it found smudged or unclear. Don't rely on it: in testing, Gemini misread many printed Amharic names without marking any of them.
- 🟦 **Blue: suggested fix.** Press **🔍 Proofread with AI** under the table. The AI compares the table with the photo again and lists only what looks wrong, each with **Use** and **Keep** buttons. In testing with Gemini it caught all 7 planted number and name mistakes with no false alarms, but fixed only 3 of 21 misread Amharic names, so check names by eye. It counts as one more request, and it uses the AI chosen in the Reader menu, so switch the menu for a second opinion from the other AI.
- **Show the photo while checking** pins the photo above the table, with + and − to zoom. The bread name column also stays in view when the table scrolls sideways.

Changing a cell clears its mark.

## Adding to an Excel file you already have
Choose **Add to existing file**, open your file, and pick the tab. ListSnap adds the scanned rows and keeps the rest of the file working:
- **Columns are matched by name.** A two-row header like the paper form (a heading such as `ጠዋት የተሰራ` merged over `ያደረ`, `ድምር`, …) counts as `ጠዋት የተሰራ: ድምር` and so on, the same names the AI readers give those columns. Columns the file doesn't have yet are added on the right.
- **Formulas carry on.** If the row above has a formula, for example `Total sales = (morning total + afternoon total) × Price`, every new row gets the same formula for its own row, so Excel calculates it. If the sheet calculates a column, its formula wins over a number from the photo.
- **Prices are filled in.** For columns the photo doesn't have, like Price, each new row takes the number from the last row with the same item (bread type). A new item gets an empty price; type it in once and the total appears.
- **A Total row stays at the bottom.** New rows go above it, and its SUM is stretched to include them.
- **Formatting is kept:** fonts, colours, the "ብር" money format, column widths and merged headings. New rows copy the look of the row above.
- New rows are always added; ListSnap doesn't change the numbers in rows that are already there.

ExcelJS (the Excel helper, about 1 MB) is downloaded the first time you open or save a file, and is kept for offline use after that.

## Good to know
- "Made" is a Yes/No checkbox. Tap the column name to change it into text or anything else.

## Files
| File | What it does |
|---|---|
| `index.html`, `style.css` | The screens |
| `app.js` | Table, scanning, templates and saving |
| `parse.js` | Turns the scanned text into item / qty / price / time / made |
| `ocr.js` | Image cleanup plus Tesseract text reading |
| `ai.js` | The Claude and Gemini readers: send the photo and get the table back, or proofread a table |
| `load.js` | Downloads the bigger helpers only when they're first needed, so the page opens quickly |
| `excel.js` | Creating and adding to `.xlsx` files with ExcelJS: formulas, prices, Total row, two-row headers, formatting |
| `drive.js` | Google sign-in and Google Drive storage |
| `config.js` | Your Google Client ID |
| `sw.js`, `manifest.json`, `icons/` | Install-as-app and offline support |
| `test.html`, `samples/` | Self-test: open http://localhost:8080/test.html |

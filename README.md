# ListSnap: a photo of a list → Excel

Take a photo of a list (item, quantity, price, morning/afternoon, made). ListSnap reads it and puts it in a table you can edit. You can then save it as a **new Excel file** or **add the rows to an Excel file you already have**. It works on phone and PC. When you sign in with Google, your files are kept in your Google Drive, so every device sees the same files.

- **Free text reading (OCR)** with Tesseract. It runs on your own device, so photos aren't uploaded anywhere.
- **Your own columns**: add, rename or delete columns and rows. Save column setups as templates (for example "Bakery morning list").
- **Add to an existing file**: pick the file and the tab, or create a new tab for a new list. Rows go at the bottom, columns are matched by name, and missing columns are added on the right.
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
- **Scanning another page into a table that already has rows** keeps your columns. The new picture's columns are matched by name (or meaning, e.g. ብዛት = Qty), and any new ones are added on the right. If the picture's header is completely different from your table, ListSnap asks whether to start a new table instead.

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

## Good to know
- When ListSnap adds rows to an existing file, it keeps the data and formulas, but **cell colors and fancy formatting may be lost** (a limit of the free Excel library). Keep a copy if the formatting matters.
- "Made" is a Yes/No checkbox. Tap the column name to change it into text or anything else.

## Files
| File | What it does |
|---|---|
| `index.html`, `style.css` | The screens |
| `app.js` | Table, scanning, templates and saving |
| `parse.js` | Turns the scanned text into item / qty / price / time / made |
| `ocr.js` | Image cleanup plus Tesseract text reading |
| `excel.js` | Creating and adding to `.xlsx` files |
| `drive.js` | Google sign-in and Google Drive storage |
| `config.js` | Your Google Client ID |
| `sw.js`, `manifest.json`, `icons/` | Install-as-app and offline support |
| `test.html`, `samples/` | Self-test: open http://localhost:8080/test.html |

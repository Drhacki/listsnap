"""
Photo to Excel

Reads a photo of a handwritten list (items and quantities), lets you check and
fix what was read, then adds the rows to the bottom of an existing Excel sheet.

Needs:  pip install anthropic openpyxl pillow
"""

import base64
import ctypes
import io
import json
import os
import queue
import shutil
import threading
import tkinter as tk
from copy import copy
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk

import anthropic
from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string, get_column_letter, range_boundaries
from PIL import Image, ImageOps, ImageTk

try:  # optional: lets iPhone .heic photos open (pip install pillow-heif)
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

MODEL = "claude-opus-5-5"
SETTINGS_FILE = Path(__file__).with_name("photo_to_excel_settings.json")
MAX_IMAGE_SIDE = 2000  # px; phone photos are shrunk to this before they're sent
UNSURE_COLOR = "#fff3b0"

PROMPT = """This is a photo of a handwritten list. Each line has an item and a quantity
(the quantity may be written before or after the item).
Read every line, top to bottom, and return them in order.

- item: the item text as written. Fix spelling only when the intended word is obvious.
  If a unit is written (kg, box, pcs, ...), add it to the item in brackets, e.g. "Rice (kg)".
- quantity: the quantity as plain digits with a dot for decimals, e.g. "3" or "0.5".
  Fractions become decimals (1/2 -> "0.5"). Use "" if no quantity is written.
- unsure: true if any part of the line is hard to read, so a person can check it.

Skip crossed-out lines, titles, dates and any other text that is not a list entry."""

SCHEMA = {
    "type": "object",
    "properties": {
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "item": {"type": "string"},
                    "quantity": {"type": "string"},
                    "unsure": {"type": "boolean"},
                },
                "required": ["item", "quantity", "unsure"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["rows"],
    "additionalProperties": False,
}

ITEM_HEADERS = ("item", "name", "product", "description", "article")
QTY_HEADERS = ("qty", "quantity", "amount", "count", "pcs", "units")


# ---------------------------------------------------------------- helpers

def load_settings():
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_settings(settings):
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2), encoding="utf-8")


def to_number(text):
    """'3' -> 3, '0.5' -> 0.5, '' -> None. Anything else is kept as text."""
    text = str(text).strip()
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return text
    return int(value) if value.is_integer() else value


def prepare_image(path):
    """Return the photo as base64 JPEG, turned upright and no bigger than MAX_IMAGE_SIDE."""
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)  # phone photos are often stored sideways
        img = img.convert("RGB")
        img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
    return base64.standard_b64encode(buf.getvalue()).decode("ascii")


def read_list_from_photo(client, path):
    """Ask Claude to read the handwritten list. Returns [{item, quantity, unsure}, ...]."""
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        # If the request is ever declined, the API retries it on its recommended fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={
            "effort": "medium",
            "format": {"type": "json_schema", "schema": SCHEMA},
        },
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": "image/jpeg", "data": prepare_image(path)}},
                {"type": "text", "text": PROMPT},
            ],
        }],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("Claude declined to read this photo.")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("The list is too long to read in one go. Try photographing it in parts.")
    text = next(b.text for b in response.content if b.type == "text")
    return parse_rows(text)


def parse_rows(text):
    """Turn Claude's JSON answer into rows with real numbers for quantities."""
    return [
        {"item": r["item"].strip(), "quantity": to_number(r["quantity"]), "unsure": bool(r["unsure"])}
        for r in json.loads(text)["rows"]
    ]


def header_text(ws, col):
    value = ws.cell(row=1, column=col).value
    return "" if value is None else str(value).strip()


def column_choices(ws):
    """Dropdown entries like 'A - Item', using row 1 as headers, plus two empty columns."""
    choices = []
    for col in range(1, ws.max_column + 3):
        header = header_text(ws, col)
        letter = get_column_letter(col)
        choices.append(f"{letter} - {header}" if header else letter)
    return choices


def guess_column(ws, words, default):
    for col in range(1, ws.max_column + 1):
        if any(w in header_text(ws, col).lower() for w in words):
            return col
    return default


def last_used_row(ws, cols):
    for row in range(ws.max_row, 0, -1):
        if any(ws.cell(row=row, column=c).value not in (None, "") for c in cols):
            return row
    return 0


def grow_tables(ws, start, end, cols):
    """If the new rows run past the bottom of an Excel table, stretch the table over them."""
    for table in ws.tables.values():
        min_col, min_row, max_col, max_row = range_boundaries(table.ref)
        covers_cols = all(min_col <= c <= max_col for c in cols)
        if covers_cols and min_row < start <= max_row + 1 and end > max_row:
            table.ref = f"{get_column_letter(min_col)}{min_row}:{get_column_letter(max_col)}{end}"
            if table.autoFilter is not None:
                table.autoFilter.ref = table.ref


def file_is_locked(path):
    """True when another program (usually Excel) has the file open."""
    try:
        with open(path, "r+b"):
            return False
    except PermissionError:
        return True


def backup_path(path):
    p = Path(path)
    return p.with_name(f"{p.stem} (backup){p.suffix}")


def add_rows_to_excel(path, sheet_name, item_col, qty_col, rows):
    """Write rows under the last filled row. Returns (first_row, last_row) written."""
    wb = load_workbook(path, keep_vba=path.lower().endswith(".xlsm"))
    ws = wb[sheet_name]
    start = last_used_row(ws, (item_col, qty_col)) + 1
    if start == 1:  # empty sheet: give it headers first
        ws.cell(row=1, column=item_col, value="Item")
        ws.cell(row=1, column=qty_col, value="Quantity")
        start = 2
    for r, row in enumerate(rows, start=start):
        for col, value in ((item_col, row["item"]), (qty_col, row["quantity"])):
            cell = ws.cell(row=r, column=col, value=value)
            above = ws.cell(row=r - 1, column=col)
            if r > 2 and above.has_style:
                cell._style = copy(above._style)  # match the formatting of the row above
    end = start + len(rows) - 1
    grow_tables(ws, start, end, (item_col, qty_col))
    shutil.copy2(path, backup_path(path))  # the file as it was before this add
    wb.save(path)
    return start, end


# ---------------------------------------------------------------- window

class App:
    def __init__(self, root):
        self.root = root
        self.settings = load_settings()
        self.rows = []         # (frame, item_entry, qty_entry)
        self.book = None       # workbook used only to show sheets and headers
        self.photo = None      # keeps the preview image alive
        self.photo_path = None
        self.results = queue.Queue()

        self.scale = root.winfo_fpixels("1i") / 96  # 1.5 on a screen scaled to 150%
        root.title("Photo to Excel")
        root.geometry(f"{int(1050 * self.scale)}x{int(680 * self.scale)}")
        root.minsize(int(820 * self.scale), int(520 * self.scale))

        # 1. Excel file
        top = ttk.LabelFrame(root, text=" 1. Excel file ", padding=8)
        top.pack(fill="x", padx=10, pady=(10, 5))
        self.file_var = tk.StringVar()
        ttk.Entry(top, textvariable=self.file_var, state="readonly").grid(
            row=0, column=0, columnspan=5, sticky="ew")
        ttk.Button(top, text="Choose...", command=self.choose_excel).grid(row=0, column=5, padx=(6, 0))
        ttk.Label(top, text="Sheet").grid(row=1, column=0, sticky="w", pady=(8, 0))
        self.sheet_box = ttk.Combobox(top, state="readonly", width=22)
        self.sheet_box.grid(row=1, column=1, sticky="w", pady=(8, 0))
        self.sheet_box.bind("<<ComboboxSelected>>", lambda e: self.show_columns())
        ttk.Label(top, text="Item column").grid(row=1, column=2, sticky="e", padx=(16, 4), pady=(8, 0))
        self.item_box = ttk.Combobox(top, state="readonly", width=24)
        self.item_box.grid(row=1, column=3, sticky="w", pady=(8, 0))
        ttk.Label(top, text="Quantity column").grid(row=1, column=4, sticky="e", padx=(16, 4), pady=(8, 0))
        self.qty_box = ttk.Combobox(top, state="readonly", width=24)
        self.qty_box.grid(row=1, column=5, sticky="w", pady=(8, 0))
        top.columnconfigure(3, weight=1)

        middle = ttk.Frame(root)
        middle.pack(fill="both", expand=True, padx=10, pady=5)

        # 2. Photo
        left = ttk.LabelFrame(middle, text=" 2. Photo of the list ", padding=8)
        left.pack(side="left", fill="y")
        self.read_button = ttk.Button(left, text="Read photo(s)...", command=self.choose_photos)
        self.read_button.pack(fill="x")
        self.preview = ttk.Label(left, text="No photo yet", anchor="center", width=46, cursor="hand2")
        self.preview.pack(fill="both", expand=True, pady=(8, 0))
        self.preview.bind("<Button-1>", lambda e: self.photo_path and os.startfile(self.photo_path))
        ttk.Label(left, text="Click the photo to open it full size.", foreground="gray").pack()

        # 3. Check the list
        right = ttk.LabelFrame(middle, text=" 3. Check the list (yellow = hard to read) ", padding=8)
        right.pack(side="left", fill="both", expand=True, padx=(10, 0))
        head = ttk.Frame(right)
        head.pack(fill="x")
        ttk.Label(head, text="Item", width=48).pack(side="left")
        ttk.Label(head, text="Quantity").pack(side="left")
        body = ttk.Frame(right)
        body.pack(fill="both", expand=True)
        self.canvas = tk.Canvas(body, highlightthickness=0)
        scroll = ttk.Scrollbar(body, orient="vertical", command=self.canvas.yview)
        self.list_frame = ttk.Frame(self.canvas)
        self.list_frame.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.create_window((0, 0), window=self.list_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scroll.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self.canvas.bind("<Enter>", lambda e: self.canvas.bind_all("<MouseWheel>", self.on_wheel))
        self.canvas.bind("<Leave>", lambda e: self.canvas.unbind_all("<MouseWheel>"))
        tools = ttk.Frame(right)
        tools.pack(fill="x", pady=(6, 0))
        ttk.Button(tools, text="+ Add row", command=lambda: self.add_row()).pack(side="left")
        ttk.Button(tools, text="Clear list", command=self.clear_rows).pack(side="left", padx=6)

        # 4. Save
        bottom = ttk.Frame(root)
        bottom.pack(fill="x", padx=10, pady=(5, 10))
        self.save_button = ttk.Button(bottom, text="4. Add to Excel", command=self.add_to_excel)
        self.save_button.pack(side="right", ipadx=12, ipady=4)
        self.status = ttk.Label(bottom, text="Choose your Excel file, then read a photo.")
        self.status.pack(side="left")

        saved = self.settings.get("excel_file")
        if saved and Path(saved).exists():
            self.open_excel(saved)

    # ---- Excel side

    def choose_excel(self):
        path = filedialog.askopenfilename(
            title="Choose the Excel file to add to",
            filetypes=[("Excel files", "*.xlsx *.xlsm"), ("All files", "*.*")])
        if path:
            self.open_excel(path)

    def open_excel(self, path):
        try:
            self.book = load_workbook(path, read_only=False)
        except Exception as e:
            messagebox.showerror("Can't open file", f"Couldn't open {Path(path).name}:\n{e}")
            return
        self.file_var.set(path)
        self.sheet_box["values"] = self.book.sheetnames
        saved_sheet = self.settings.get("sheet") if path == self.settings.get("excel_file") else None
        self.sheet_box.set(saved_sheet if saved_sheet in self.book.sheetnames else self.book.sheetnames[0])
        self.show_columns()

    def show_columns(self):
        ws = self.book[self.sheet_box.get()]
        choices = column_choices(ws)
        self.item_box["values"] = choices
        self.qty_box["values"] = choices
        same_place = (self.file_var.get() == self.settings.get("excel_file")
                      and self.sheet_box.get() == self.settings.get("sheet"))
        item_col = guess_column(ws, ITEM_HEADERS, 1)
        qty_col = guess_column(ws, QTY_HEADERS, item_col + 1)
        if same_place and self.settings.get("item_col"):
            item_col = column_index_from_string(self.settings["item_col"])
            qty_col = column_index_from_string(self.settings["qty_col"])
        self.item_box.set(choices[min(item_col, len(choices)) - 1])
        self.qty_box.set(choices[min(qty_col, len(choices)) - 1])

    @staticmethod
    def column_number(box):
        return column_index_from_string(box.get().split(" - ")[0])

    # ---- Photo side

    def get_client(self):
        if os.environ.get("ANTHROPIC_API_KEY"):
            return anthropic.Anthropic()
        key = self.settings.get("api_key")
        if not key:
            key = simpledialog.askstring(
                "Anthropic API key",
                "Paste your Anthropic API key.\n"
                "(Get one at console.anthropic.com, under API keys.)\n\n"
                "It is saved on this PC, so you only do this once.",
                show="*", parent=self.root)
            if not key:
                return None
            self.settings["api_key"] = key.strip()
            save_settings(self.settings)
        return anthropic.Anthropic(api_key=self.settings["api_key"])

    def choose_photos(self):
        paths = filedialog.askopenfilenames(
            title="Choose photo(s) of the list",
            filetypes=[("Photos", "*.jpg *.jpeg *.png *.webp *.bmp *.gif *.heic"), ("All files", "*.*")])
        if not paths:
            return
        client = self.get_client()
        if client is None:
            return
        self.read_button.state(["disabled"])
        self.save_button.state(["disabled"])
        threading.Thread(target=self.read_photos, args=(client, paths), daemon=True).start()
        self.root.after(200, self.check_results)

    def read_photos(self, client, paths):
        """Runs in the background so the window doesn't freeze."""
        for n, path in enumerate(paths, start=1):
            self.results.put(("status", f"Reading photo {n} of {len(paths)}: {Path(path).name} ..."))
            try:
                self.results.put(("rows", path, read_list_from_photo(client, path)))
            except anthropic.AuthenticationError:
                self.results.put(("bad_key",))
                break
            except anthropic.RateLimitError:
                self.results.put(("error", "Too many requests right now. Wait a minute and try again."))
                break
            except anthropic.APIStatusError as e:
                self.results.put(("error", f"The Claude API returned an error ({e.status_code}):\n{e.message}"))
                break
            except anthropic.APIConnectionError:
                self.results.put(("error", "Couldn't reach the Claude API. Check your internet connection."))
                break
            except Exception as e:
                self.results.put(("error", f"Couldn't read {Path(path).name}:\n{e}"))
        self.results.put(("done",))

    def check_results(self):
        while not self.results.empty():
            kind, *data = self.results.get()
            if kind == "status":
                self.status["text"] = data[0]
            elif kind == "rows":
                path, rows = data
                self.show_photo(path)
                for row in rows:
                    self.add_row(row["item"], row["quantity"], row["unsure"])
                unsure = sum(r["unsure"] for r in rows)
                self.status["text"] = (f"Read {len(rows)} lines from {Path(path).name}."
                                       + (f" {unsure} highlighted in yellow - please check them." if unsure else ""))
            elif kind == "bad_key":
                self.settings.pop("api_key", None)
                save_settings(self.settings)
                messagebox.showerror("API key", "The API key wasn't accepted. You'll be asked for it again.")
            elif kind == "error":
                messagebox.showerror("Problem reading photo", data[0])
            elif kind == "done":
                self.read_button.state(["!disabled"])
                self.save_button.state(["!disabled"])
                return
        self.root.after(200, self.check_results)

    def show_photo(self, path):
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            img.thumbnail((int(340 * self.scale), int(470 * self.scale)))
            self.photo = ImageTk.PhotoImage(img)
        self.photo_path = path
        self.preview.configure(image=self.photo, text="")

    # ---- The editable list

    def add_row(self, item="", quantity=None, unsure=False):
        frame = ttk.Frame(self.list_frame)
        frame.pack(fill="x", pady=1)
        color = UNSURE_COLOR if unsure else "white"
        item_entry = tk.Entry(frame, width=55, bg=color)
        item_entry.insert(0, item)
        item_entry.pack(side="left")
        qty_entry = tk.Entry(frame, width=12, bg=color)
        qty_entry.insert(0, "" if quantity is None else str(quantity))
        qty_entry.pack(side="left", padx=4)
        for entry in (item_entry, qty_entry):  # editing a row marks it as checked
            entry.bind("<Key>", lambda e, a=item_entry, b=qty_entry: (a.config(bg="white"), b.config(bg="white")))
        row = (frame, item_entry, qty_entry)
        ttk.Button(frame, text="X", width=3, command=lambda: self.remove_row(row)).pack(side="left")
        self.rows.append(row)
        if not item:
            item_entry.focus_set()

    def remove_row(self, row):
        row[0].destroy()
        self.rows.remove(row)

    def clear_rows(self):
        for row in list(self.rows):
            self.remove_row(row)

    def collect_rows(self):
        rows = []
        for _, item_entry, qty_entry in self.rows:
            item, quantity = item_entry.get().strip(), to_number(qty_entry.get())
            if item or quantity is not None:
                rows.append({"item": item or None, "quantity": quantity})
        return rows

    def on_wheel(self, event):
        self.canvas.yview_scroll(int(-event.delta / 120), "units")

    # ---- Save

    def add_to_excel(self):
        path = self.file_var.get()
        if not path:
            messagebox.showwarning("Photo to Excel", "Choose the Excel file first (step 1).")
            return
        rows = self.collect_rows()
        if not rows:
            messagebox.showwarning("Photo to Excel", "There's nothing in the list to add yet.")
            return
        item_col, qty_col = self.column_number(self.item_box), self.column_number(self.qty_box)
        if item_col == qty_col:
            messagebox.showwarning("Photo to Excel", "Item and Quantity can't go in the same column.")
            return
        not_numbers = [str(r["quantity"]) for r in rows if isinstance(r["quantity"], str)]
        if not_numbers and not messagebox.askyesno(
                "Check quantities",
                "These quantities aren't plain numbers and will be saved as text:\n\n"
                + ", ".join(not_numbers[:10]) + "\n\nAdd them anyway?"):
            return
        if file_is_locked(path):
            messagebox.showerror("File is open", f"{Path(path).name} is open in Excel.\nClose it there and try again.")
            return
        sheet = self.sheet_box.get()
        try:
            first, last = add_rows_to_excel(path, sheet, item_col, qty_col, rows)
        except PermissionError:
            messagebox.showerror("File is open", f"{Path(path).name} is open in Excel.\nClose it there and try again.")
            return
        except Exception as e:
            messagebox.showerror("Couldn't save", f"Nothing was changed.\n\n{e}")
            return

        self.settings.update(excel_file=path, sheet=sheet,
                             item_col=get_column_letter(item_col), qty_col=get_column_letter(qty_col))
        save_settings(self.settings)
        self.clear_rows()
        self.open_excel(path)  # refresh headers in case the sheet was empty
        self.status["text"] = f"Added {len(rows)} rows to '{sheet}' (rows {first}-{last})."
        if messagebox.askyesno(
                "Done",
                f"Added {len(rows)} rows to '{sheet}', rows {first} to {last}.\n\n"
                f"The file as it was before is saved as\n{backup_path(path).name}\n\nOpen the Excel file now?"):
            os.startfile(path)


def sharp_on_scaled_screens():
    """Without this, Windows stretches the window and the text looks blurry on laptops."""
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except (AttributeError, OSError):
        pass


if __name__ == "__main__":
    sharp_on_scaled_screens()
    root = tk.Tk()
    App(root)
    root.mainloop()

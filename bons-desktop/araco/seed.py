"""Sample data: ~20 customers with sites and ~150 tickets, some with a drawn ticket image."""
import random
from datetime import date, timedelta
from pathlib import Path

from . import config
from .services import customers, tickets

CUSTOMERS = [
    ("جورج حداد", "حداد للمقاولات", "03 214 558", "زحلة", ["بناية الكرك", "فيلا كسارة"], "30 يوم"),
    ("Rami Saad", "Saad Construction", "70 118 342", "Jbeil", ["Byblos Marina Tower"], "Cash"),
    ("محمد الحسيني", "", "71 556 900", "صيدا", ["مدرسة الهلالية"], "نقدي"),
    ("Elie Khoury", "Khoury & Sons", "03 667 120", "Jounieh", ["Kaslik Residence", "Ghazir Villas"], "60 days"),
    ("شركة الأمل للمقاولات", "الأمل", "01 345 678", "بيروت", ["مشروع الأشرفية", "برج الحمرا"], "45 يوم"),
    ("Nadim Frem", "Frem Engineering", "76 412 007", "Baabda", ["Hazmieh Offices"], "30 days"),
    ("علي شمص", "", "70 903 221", "بعلبك", ["مستودع دورس"], "نقدي"),
    ("Joseph Abi Nader", "JAN Builders", "03 880 451", "Batroun", ["Batroun Beach Resort"], "30 days"),
    ("خالد المصري", "المصري للبناء", "81 234 567", "طرابلس", ["مجمع الميناء", "بناية أبي سمراء"], "30 يوم"),
    ("Pierre Gemayel", "", "03 991 004", "Bikfaya", ["Private villa"], "Cash"),
    ("وليد أبو شقرا", "أبو شقرا إخوان", "70 345 812", "عاليه", ["فيلا عين الصحة"], "60 يوم"),
    ("Hassan Fakih", "Fakih Contracting", "71 777 012", "Nabatieh", ["Nabatieh Hospital Annex"], "45 days"),
    ("بلدية جونية", "", "09 640 100", "جونية", ["رصيف الكورنيش", "موقف السيارات"], "حسب العقد"),
    ("Marc Tannous", "Tannous Group", "03 450 219", "Dbayeh", ["Waterfront Block C"], "30 days"),
    ("سامي رزق", "", "76 220 314", "زغرتا", ["منزل إهدن"], "نقدي"),
    ("Karim Haddad", "Cedar Developments", "03 116 776", "Achrafieh", ["Sursock Lofts"], "60 days"),
    ("فادي نصر", "نصر للهندسة", "70 640 528", "المتن", ["مجمع بيت مري"], "30 يوم"),
    ("Ziad Bou Khalil", "", "71 302 455", "Chouf", ["Deir el Qamar House"], "Cash"),
    ("مؤسسة الجنوب للإعمار", "الجنوب", "07 721 900", "صور", ["مدرسة صور الرسمية"], "45 يوم"),
    ("Antoine Sfeir", "Sfeir Real Estate", "03 505 818", "Broummana", ["Broummana Heights"], "30 days"),
]
GRADES = [("B250", 70), ("B300", 75), ("B350", 82), ("B200", 65), ("B400", 90)]
TRUCKS = ["M-11", "M-12", "M-14", "M-17", "M-21", "M-23"]
DRIVERS = ["علي حمود", "Georges Daou", "محمد زعيتر", "Tony Rizk", "حسين عواضة", "Charbel Nehme"]
PUMPS = ["P-1", "P-2"]
PLANTS = ["Plant 1", "Plant 2"]


def draw_ticket_image(path, ticket_no, day, time, customer, grade, quantity, truck):
    """A clean, ticket-like JPEG (used for the demo and the OCR test)."""
    from PIL import Image, ImageDraw, ImageFont
    w, h = 1240, 1754  # A4-ish at 150 dpi
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)

    def font(size):
        for name in ("arial.ttf", "DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                continue
        return ImageFont.load_default()

    big, mid = font(56), font(40)
    d.rectangle([40, 40, w - 40, h - 40], outline="black", width=4)
    d.text((80, 80), "ARACO READY MIX", font=big, fill="black")
    d.text((80, 160), "Delivery Ticket", font=mid, fill="black")
    lines = [f"Ticket No: {ticket_no}", f"Date: {day[8:10]}/{day[5:7]}/{day[:4]}", f"Time: {time}",
             f"Customer: {customer}", f"Grade: {grade}", f"Quantity: {quantity} m3", f"Truck: {truck}"]
    y = 320
    for line in lines:
        d.text((80, y), line, font=mid, fill="black")
        y += 90
    d.line([80, h - 260, 520, h - 260], fill="black", width=2)
    d.text((80, h - 240), "Signature", font=mid, fill="black")
    img.save(path, "JPEG", quality=85)
    return Path(path)


def draw_delivery_journal(path, voucher, day, time, customer, address, project, quantity, concrete_class, truck,
                          driver, pump=""):
    """A delivery note in the layout of ARACO's printed 'Delivery Journal' (blue ink on cyan paper).

    Used for the sample scans and to test OCR on the real form layout.
    """
    from PIL import Image, ImageDraw, ImageFont
    w, h = 1545, 1000
    ink, paper = (45, 140, 235), (215, 252, 252)
    img = Image.new("RGB", (w, h), paper)
    d = ImageDraw.Draw(img)

    def font(size, bold=False):
        names = (("arialbd.ttf", "DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
                 if bold else ("arial.ttf", "DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
        for name in names:
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                continue
        return ImageFont.load_default()

    f, fb, fs = font(24), font(24, True), font(19)
    left, right = 120, 1495
    for y in (35, 108, 152, 194, 262, 377, 418, 466, 546, 598, 638, 805, 902):
        d.line([left, y, right, y], fill=ink, width=3)
    for x, y1, y2 in ((left, 35, 902), (right, 35, 902), (957, 108, 262), (270, 262, 418), (590, 262, 598),
                      (957, 262, 598), (1147, 262, 598), (800, 300, 418), (1327, 466, 598), (773, 805, 902)):
        d.line([x, y1, x, y2], fill=ink, width=3)
    d.line([590, 300, 957, 300], fill=ink, width=3)
    d.text((708, 60), "DELIVERY JOURNAL", font=fb, fill=ink)
    d.text((190, 120), f"DELIVERY VOUCHER:      {voucher}", font=f, fill=ink)
    d.text((1000, 120), f"DATE:      {day[8:10]}-{day[5:7]}-{day[:4]}", font=f, fill=ink)
    d.text((190, 162), f"CUSTOMER:          {customer}", font=f, fill=ink)
    d.text((985, 162), "DESTINATION:", font=f, fill=ink)
    d.text((190, 204), f"ADDRESS:        {address}", font=f, fill=ink)
    d.text((985, 232), f"Project Name:          {project}", font=f, fill=ink)
    d.text((132, 292), "CUBIC\nMETERES", font=fb, fill=ink)
    d.text((385, 308), "CLASS", font=fb, fill=ink)
    d.text((718, 270), "CEMENT", font=f, fill=ink)
    d.text((635, 315), "DOSAGE\n(Kg/m3)", font=f, fill=ink)
    d.text((985, 315), "D. MAX\nAGG. (mm)", font=f, fill=ink)
    d.text((180, 387), f"{quantity:g}", font=f, fill=ink)
    d.text((315, 387), concrete_class, font=f, fill=ink)
    d.text((140, 440), f"TRUCK MIXER N#:     {truck}", font=fs, fill=ink)
    d.text((614, 440), f"Driver:                    {driver}", font=fs, fill=ink)
    d.text((1168, 440), f"Pump No#:   {pump}", font=fs, fill=ink)
    d.text((278, 495), "Start Loading", font=f, fill=ink)
    d.text((700, 495), "Arrive at site", font=f, fill=ink)
    d.text((300, 560), f"{time} {'PM' if int(time[:2]) >= 12 else 'AM'}", font=f, fill=ink)
    d.text((490, 608), "Water added at customer request........................Liter", font=fb, fill=ink)
    d.text((125, 650), "Please note:\nWe will be responsible for the product delivered at the site before any water\n"
                       "or other material added.", font=f, fill=ink)
    d.text((885, 812), "Received Accepted by:", font=f, fill=ink)
    img.save(path, "JPEG", quality=88)
    return Path(path)


def is_latin(s: str) -> bool:
    return all(ord(ch) < 0x0600 for ch in s)


def seed(ctx, n_tickets: int = 150, with_images: int = 12, rnd_seed: int = 7, today: date | None = None) -> dict:
    """Insert the sample data. Safe to call only on an empty database."""
    rnd = random.Random(rnd_seed)
    today = today or date.today()
    ids = []
    for name, company, phone, area, sites, terms in CUSTOMERS:
        cid = customers.create(ctx, {"name": name, "company": company, "phone": phone, "area": area,
                                     "address": area, "payment_terms": terms}, sites=sites)
        ids.append((cid, name, [s["id"] for s in customers.sites(ctx.db, cid)]))
    inbox = config.inbox_dir()
    images = 0
    for i in range(n_tickets):
        cid, cname, site_ids = rnd.choice(ids)
        day = today - timedelta(days=int(rnd.triangular(0, 120, 0)))
        grade, price = rnd.choice(GRADES)
        qty = rnd.choice([4, 6, 7, 8, 8, 9, 10, 10, 12])
        pump = rnd.random() < 0.35
        no = str(250100 + i)
        t = f"{rnd.randint(6, 16):02d}:{rnd.choice(['00', '15', '30', '45'])}"
        truck = rnd.choice(TRUCKS)
        data = {"ticket_no": no, "date": day.isoformat(), "time": t, "customer_id": cid,
                "site_id": rnd.choice(site_ids), "grade": grade, "quantity": qty, "unit_price": price,
                "truck_no": truck, "driver": rnd.choice(DRIVERS), "pump_used": pump,
                "pump_no": rnd.choice(PUMPS) if pump else "", "plant": rnd.choice(PLANTS),
                "status": "cancelled" if rnd.random() < 0.04 else "delivered"}
        scans = []
        if images < with_images and is_latin(cname):
            data["driver"] = rnd.choice([d for d in DRIVERS if is_latin(d)])
            site = customers.sites(ctx.db, cid)[0]["name"]
            data["site_id"] = customers.sites(ctx.db, cid)[0]["id"]
            img = draw_delivery_journal(inbox / f"demo_{no}.jpg", f"26TS{no}", data["date"], t, cname.upper(),
                                        "BEIRUT", site.upper(), qty, f"RMC {grade} TYPE-1/J", truck,
                                        data["driver"], data["pump_no"])
            scans.append(img)
            images += 1
        tid = tickets.create(ctx, data)
        for img in scans:
            tickets.attach_scan(ctx, tid, img, move=True)
    return {"customers": len(ids), "tickets": n_tickets, "images": images}


def wipe_business_data(ctx):
    """Remove all customers, sites, tickets (keeps users, lists and settings).

    A database backup is taken first and scan files are moved to backups/scans_before_wipe_<time>.
    """
    import shutil
    from datetime import datetime

    from . import backup
    from .services import audit
    ctx.require_admin()
    backup.backup_now(ctx.db)
    with ctx.db.conn:
        ctx.db.execute("DELETE FROM ticket_scans")
        ctx.db.execute("DELETE FROM tickets")
        ctx.db.execute("DELETE FROM sites")
        ctx.db.execute("DELETE FROM customers")
        audit.log(ctx, "wipe", "all")
    keep = config.backups_dir() / f"scans_before_wipe_{datetime.now():%Y-%m-%d_%H%M%S}"
    for child in config.scans_dir().iterdir():
        if child.is_dir() and child.name != "_inbox":
            keep.mkdir(parents=True, exist_ok=True)
            shutil.move(str(child), keep / child.name)

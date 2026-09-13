from __future__ import annotations

import argparse
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
except ImportError:  # pragma: no cover
    arabic_reshaper = None
    get_display = None


OUT = Path(__file__).resolve().parent
PDF = OUT / "job_offer_blank.pdf"
MAP = OUT / "job_offer_blank_field_map.json"
W, H = A4
ORANGE, TEXT, MUTED, BORDER, CELL, DATA = (colors.HexColor(v) for v in ("#FF5A00", "#151515", "#55585C", "#C8CBCF", "#ECEDEF", "#FCFCFC"))
FIELDS: dict[str, dict] = {}


def fonts():
    found = []
    for name, candidates in {"FFIReg": [r"C:\\Windows\\Fonts\\arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"], "FFIBold": [r"C:\\Windows\\Fonts\\arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]}.items():
        font = "Helvetica-Bold" if name.endswith("Bold") else "Helvetica"
        for candidate in candidates:
            if Path(candidate).exists():
                pdfmetrics.registerFont(TTFont(name, candidate)); font = name; break
        found.append(font)
    return found


REG, BOLD = fonts()
def bot(top, height=0): return H - top - height
def ar(value): return get_display(arabic_reshaper.reshape(value)) if arabic_reshaper and get_display else value
def txt(c, x, top, value, size=7, bold=False, right=False, color=TEXT):
    c.setFillColor(color); c.setFont(BOLD if bold else REG, size)
    (c.drawRightString if right else c.drawString)(x, H-top-size, value)
def artxt(c, x, top, value, size=7, **kwargs): txt(c, x, top, ar(value), size * 1.18, right=True, **kwargs)
def box(c, x, top, width, height, fill=DATA):
    c.setFillColor(fill); c.setStrokeColor(BORDER); c.setLineWidth(.55); c.rect(x, bot(top,height), width, height, fill=1, stroke=1)
def mapfield(key, x, top, width, height, **extra): FIELDS[key] = {"page":1,"x":round(x,2),"y":round(bot(top,height),2),"width":round(width,2),"height":round(height,2),**extra}
def input(c, key, x, top, width, height, **extra): box(c,x,top,width,height); mapfield(key,x,top,width,height,**extra)
def section(c, top, en, ara):
    c.setFillColor(ORANGE); c.rect(15,bot(top+5,6),6,6,fill=1,stroke=0); txt(c,28,top,en,10.5,True); artxt(c,W-17,top,ara,10.5,bold=True)
def row(c, top, key, en, ara, height=25):
    box(c,15,top,87,height,CELL); box(c,W-85,top,70,height,CELL); txt(c,23,top+(height-7)/2,en,6.4); artxt(c,W-22,top+(height-7)/2,ara,6.4); input(c,key,102,top+3,406,height-6,font_size=7.6,shrink=True)
def halfrow(c, x, top, key, en, ara):
    width=274; box(c,x,top,width,25,CELL); txt(c,x+8,top+9,en,6.2); artxt(c,x+width-8,top+9,ara,6.2); input(c,key,x+122,top+3,96,19,font_size=7.2,shrink=True)

def approval_panel(c, x, top, width, role_en, role_ar, name_key, date_key, signature_key, source):
    txt(c,x+8,top,role_en,7,True,color=MUTED); artxt(c,x+width-8,top,role_ar,6.6,bold=True,color=MUTED)
    signature_top=top+13; signature_height=45
    mapfield(signature_key,x+8,signature_top,width-16,signature_height,kind="image",padding=1,source=source)
    box(c,x+4,top+60,width-8,20,CELL)
    txt(c,x+10,top+66,"Name",6.3,True,color=MUTED); artxt(c,x+width-10,top+66,"الاسم",6.1,bold=True,color=MUTED)
    input(c,name_key,x+48,top+63,width-142,14,font_size=6.8,shrink=True)
    box(c,x+4,top+82,width-8,20,CELL)
    txt(c,x+10,top+88,"Date",6.3,True,color=MUTED); artxt(c,x+width-10,top+88,"التاريخ",6.1,bold=True,color=MUTED)
    input(c,date_key,x+48,top+85,width-142,14,font_size=6.8,shrink=True)


def build(logo: Path):
    if not logo.exists(): raise FileNotFoundError(logo)
    FIELDS.clear(); c=canvas.Canvas(str(PDF),pagesize=A4,pageCompression=1); c.setTitle("FFI Job Offer Blank Template")
    image=ImageReader(str(logo)); lw=220; lh=lw*image.getSize()[1]/image.getSize()[0]; c.drawImage(image,15,bot(14,lh),lw,lh,mask="auto")
    txt(c,W-15,14,"Job Offer",18,True,True); artxt(c,W-15,42,"عرض عمل",18,bold=True); c.setStrokeColor(ORANGE); c.setLineWidth(.8); c.line(15,bot(73),W-15,bot(73))
    box(c,15,81,273,28,CELL); box(c,297,81,283,28,CELL); txt(c,23,91,"Reference No.",7.3,True); input(c,"reference_no",89,86,78,18,font_size=8); txt(c,305,91,"Offer Date",7.3,True); input(c,"offer_date",390,86,120,18,font_size=7.4)
    section(c,122,"Applicant Details","بيانات المتقدم")
    for i,args in enumerate([("applicant_name","Applicant Name","اسم المتقدم"),("nationality","Nationality","الجنسية"),("id_no","ID No.","رقم الهوية")]): row(c,141+i*25,*args)
    section(c,225,"Offer Introduction","مقدمة العرض"); box(c,15,244,W-30,54,DATA); txt(c,28,255,"Following your job application and interview assessment, we are pleased to present this official job offer.",7.2,color=MUTED); txt(c,28,272,"Please review the employment, salary, benefits, and acceptance details below.",7.2,color=MUTED); artxt(c,W-28,286,"يسرنا أن نقدم لكم عرض العمل الرسمي حسب تفاصيل الوظيفة والراتب والمزايا أدناه.",6.5,color=MUTED)
    section(c,313,"Job Details","تفاصيل الوظيفة"); halfrow(c,15,332,"position","Position","مسمى الوظيفة"); halfrow(c,306,332,"classification","Classification","التصنيف"); halfrow(c,15,357,"department","Department","الإدارة"); halfrow(c,306,357,"work_location","Location","الموقع")
    section(c,397,"Monthly Salary Details","تفاصيل الراتب الشهري")
    salary=[("basic_salary","Basic Salary","الراتب الأساسي"),("transportation_allowance","Transportation Allowance","بدل المواصلات"),("other_salary_item","Other","أخرى")]; salary2=[("housing_allowance","Housing Allowance","بدل السكن"),("other_allowance","Other Allowance","بدلات أخرى"),("total_paid_salary","Total Package Paid Salary","إجمالي الراتب المتوقع")]
    for i in range(3): halfrow(c,15,416+i*21,*salary[i]); halfrow(c,306,416+i*21,*salary2[i])
    section(c,482,"Benefits / Contract Details","تفاصيل المزايا / العقد")
    left=[("vacation_days","Vacation","مدة الإجازة"),("contract_status","Contract Status","حالة العقد"),("medical_insurance","Medical Insurance","العلاج الطبي")]; right=[("tickets","Tickets","تذاكر السفر"),("contract_type","Contract Type","نوع العقد"),("contract_duration","Contract Duration","مدة العقد")]
    for i in range(3): halfrow(c,15,501+i*21,*left[i]); halfrow(c,306,501+i*21,*right[i])
    section(c,567,"Validity Note","ملاحظة صلاحية العرض"); box(c,15,586,W-30,35,DATA); txt(c,28,594,"This offer is not binding on Fathi Fouad Itani Contracting Co. until the employment contract is signed and recruitment procedures are completed.",6.1,color=MUTED); txt(c,28,607,"This offer is valid for one week from its date.",6.1,color=MUTED); artxt(c,W-28,610,"هذا العرض غير ملزم للشركة حتى توقيع عقد العمل واستكمال إجراءات التعيين.",6.1,color=MUTED)
    section(c,628,"Approval Signatures","توقيعات الاعتماد"); c.setStrokeColor(ORANGE); c.setLineWidth(.9); c.line(15,bot(647),W-15,bot(647))
    approval_panel(c,15,650,274,"HR","الموارد البشرية","hr_name","hr_signature_date","hr_signature_image","job_offer.hr.signature")
    approval_panel(c,306,650,274,"CEO","الرئيس التنفيذي","ceo_name","ceo_signature_date","ceo_signature_image","job_offer.ceo.signature")
    c.setStrokeColor(BORDER); c.setLineWidth(.45); c.line(297,bot(648),297,bot(754))

    section(c,756,"Applicant Decision","قرار المتقدم"); c.setStrokeColor(ORANGE); c.line(15,bot(775),W-15,bot(775))
    box(c,15,780,565,19,CELL); txt(c,23,786,"Applicant Name",6.4,True); artxt(c,W-23,786,"اسم المتقدم",6.2,bold=True); input(c,"applicant_name_acceptance",105,782,385,14,font_size=7.2,shrink=True)
    agree=(145,bot(805,10)+5); reject=(300,bot(805,10)+5); FIELDS["applicant_decision"]={"page":1,"checkboxes":{"agree":agree,"reject":reject}}
    box(c,140,805,10,10,colors.white); txt(c,156,805,"I agree",6.4); artxt(c,225,805,"أوافق",6.1)
    box(c,295,805,10,10,colors.white); txt(c,311,805,"I do not agree",6.4); artxt(c,402,805,"لا أوافق",6.1)
    box(c,425,802,155,18,CELL); txt(c,433,807,"Date",6.2,True); artxt(c,572,807,"التاريخ",6.0,bold=True); input(c,"applicant_decision_date",470,804,62,14,font_size=6.8,shrink=True)
    box(c,15,821,565,18,CELL); txt(c,23,826,"Reason",6.2,True); artxt(c,W-23,826,"السبب",6.0,bold=True); input(c,"rejection_reason",75,823,435,14,font_size=6.6,multiline=True,max_lines=2,padding=3)
    c.showPage(); c.save(); MAP.write_text(json.dumps(FIELDS,ensure_ascii=False,indent=2),encoding="utf-8")


if __name__ == "__main__":
    parser=argparse.ArgumentParser(); parser.add_argument("--logo",type=Path,default=Path("output_logo_transparent.png")); build(parser.parse_args().logo)

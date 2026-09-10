from __future__ import annotations
import argparse,json
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
except ImportError: arabic_reshaper=get_display=None
OUT=Path(__file__).resolve().parent; PDF=OUT/'starting_work_acknowledgment_blank.pdf'; MAP=OUT/'starting_work_acknowledgment_blank_field_map.json'; W,H=A4
O,T,M,B,C,D=(colors.HexColor(x) for x in ('#FF5A00','#151515','#55585C','#C8CBCF','#ECEDEF','#FCFCFC')); F={}
def fonts():
 out=[]
 for n,ps in {'R':[r'C:\\Windows\\Fonts\\arial.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],'B':[r'C:\\Windows\\Fonts\\arialbd.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']}.items():
  z='Helvetica-Bold' if n=='B' else 'Helvetica'
  for p in ps:
   if Path(p).exists(): pdfmetrics.registerFont(TTFont('FFI'+n,p));z='FFI'+n;break
  out.append(z)
 return out
R,BD=fonts()
def bo(t,h=0):return H-t-h
def ar(s):return get_display(arabic_reshaper.reshape(s)) if arabic_reshaper and get_display else s
def tx(c,x,t,s,size=7,bold=False,right=False,col=T):
 c.setFillColor(col);c.setFont(BD if bold else R,size);(c.drawRightString if right else c.drawString)(x,H-t-size,s)
def at(c,x,t,s,size=7,**kw):tx(c,x,t,ar(s),size*1.18,right=True,**kw)
def bx(c,x,t,w,h,fill=D):c.setFillColor(fill);c.setStrokeColor(B);c.setLineWidth(.55);c.rect(x,bo(t,h),w,h,fill=1,stroke=1)
def mp(k,x,t,w,h,**e):F[k]={'page':1,'x':round(x,2),'y':round(bo(t,h),2),'width':round(w,2),'height':round(h,2),**e}
def inp(c,k,x,t,w,h,**e):bx(c,x,t,w,h);mp(k,x,t,w,h,**e)
def sec(c,t,en,ara):c.setFillColor(O);c.rect(15,bo(t+5,6),6,6,fill=1,stroke=0);tx(c,28,t,en,10.5,True);at(c,W-17,t,ara,10.5,bold=True)
def row(c,t,k,en,ara):bx(c,15,t,98,23,C);bx(c,W-85,t,70,23,C);tx(c,23,t+8,en,6.2);at(c,W-22,t+8,ara,6.2);inp(c,k,113,t+3,397,17,font_size=7.5,shrink=True)
def sig(c,k,x,t,w,en,ara):
 tx(c,x+10,t,en,6.8,True,col=M);at(c,x+w-10,t,ara,6.4,col=M);F[k+'_signature_image']={'page':1,'x':x+10,'y':round(bo(t+15,38),2),'width':w-20,'height':38,'kind':'image','padding':3,'source':'starting_work.signers.'+k+'.signature'};c.setStrokeColor(M);c.line(x+10,bo(t+55),x+w-10,bo(t+55));tx(c,x+10,t+64,'Signature',6,col=M);c.line(x+62,bo(t+70),x+w-10,bo(t+70))
def build(logo):
 if not logo.exists():raise FileNotFoundError(logo)
 F.clear();c=canvas.Canvas(str(PDF),pagesize=A4,pageCompression=1);c.setTitle('FFI Acknowledgment of Starting Work Blank Template');im=ImageReader(str(logo));lw=220;lh=lw*im.getSize()[1]/im.getSize()[0];c.drawImage(im,15,bo(14,lh),lw,lh,mask='auto');tx(c,W-15,14,'Acknowledgment of Starting Work',15,True,True);at(c,W-15,43,'مباشرة عمل',18,bold=True);c.setStrokeColor(O);c.setLineWidth(.8);c.line(15,bo(73),W-15,bo(73))
 bx(c,15,81,273,28,C);bx(c,297,81,283,28,C);tx(c,23,91,'Reference No.',7.3,True);inp(c,'reference_no',89,86,78,18,font_size=8);tx(c,305,91,'Date',7.3,True);inp(c,'document_date',390,86,120,18,font_size=7.4)
 sec(c,122,'Handover Information','بيانات تسليم العمل');bx(c,15,141,W-30,50,D);tx(c,28,151,'Dear Manager,',7,True);tx(c,28,167,'Please hand over the job to the employee below and confirm the actual starting work date.',6.8,col=M);at(c,W-28,181,'يرجى تسليم العمل للموظف الموضح أدناه وإفادة الموارد البشرية بتاريخ المباشرة الفعلي.',6.0,col=M)
 for i,a in enumerate([('addressed_to','Dear Mr. / Ms.','عناية السيد / السيدة'),('employee_name','Employee Name','اسم الموظف'),('employee_no','Employee No.','الرقم الوظيفي'),('job_title','Job Title','المسمى الوظيفي'),('id_no','ID No.','رقم الهوية'),('department','Department','الإدارة'),('direct_superior','Direct Superior','الرئيس المباشر')]):row(c,199+i*23,*a)
 sec(c,368,'Direct Superior Signature','توقيع الرئيس المباشر');c.setStrokeColor(O);c.line(15,bo(387),W-15,bo(387));F['direct_superior_signature']={'page':1,'x':25,'y':round(bo(401,35),2),'width':539,'height':35,'kind':'image','padding':3,'source':'starting_work.signers.direct_superior.signature'};c.setStrokeColor(M);c.line(25,bo(438),564,bo(438));tx(c,25,447,'Signature',6,col=M);c.line(78,bo(453),420,bo(453));tx(c,438,447,'Date',6,col=M);c.line(468,bo(453),564,bo(453))
 sec(c,466,'Starting Work Confirmation','تأكيد مباشرة العمل');bx(c,15,485,W-30,50,D);tx(c,28,496,'To HR Department:',6.8,True);tx(c,28,512,'The employee has started work on the date shown below. Please complete the recruitment process.',6.4,col=M);at(c,W-28,525,'نؤكد لكم أن الموظف قد باشر العمل حسب التاريخ الموضح أدناه. يرجى استكمال إجراءات التعيين.',5.8,col=M)
 bx(c,15,545,W-30,25,C);tx(c,23,554,'The above employee has started work on:',6.4,True);F['work_start_status']={'page':1,'checkboxes':{'started':[267,bo(551,10)+5],'not_started':[389,bo(551,10)+5]}};bx(c,262,551,10,10,colors.white);tx(c,278,552,'Started',6.2);bx(c,384,551,10,10,colors.white);tx(c,400,552,'Not started',6.2)
 bx(c,15,578,273,27,C);tx(c,23,588,'Department',6.2);inp(c,'start_department',110,582,108,19,font_size=7.2,shrink=True)
 for x,k,l,w in [(297,'start_day','Day',88),(394,'start_month','Month',88),(491,'start_year','Year',89)]:bx(c,x,578,w,27,C);tx(c,x+8,588,l,6.2);inp(c,k,x+42,585,w-50,13,font_size=7)
 sec(c,620,'Approvals','الاعتمادات');c.setStrokeColor(O);c.line(15,bo(639),W-15,bo(639));sig(c,'general_manager',15,649,274,'General Manager Approval','اعتماد المدير العام');sig(c,'details_approver',306,649,274,'Approval of Details','اعتماد صحة البيانات');mp('general_manager_name',25,666,120,18,font_size=7,shrink=True);mp('general_manager_date',160,666,110,18,font_size=7);mp('details_approver_name',316,666,120,18,font_size=7,shrink=True);mp('details_approver_date',451,666,110,18,font_size=7)
 sec(c,732,'Not Starting Work','في حال عدم المباشرة');bx(c,15,751,W-30,27,D);tx(c,28,760,'If the employee did not start work, please state the reason and return the form to HR.',6.1,True);inp(c,'not_started_reason',25,782,539,19,font_size=6.8,multiline=True,max_lines=2);tx(c,25,809,'Name',6,col=M);inp(c,'not_started_name',25,819,160,14,font_size=7);tx(c,205,809,'Signature',6,col=M);F['not_started_signature']={'page':1,'x':205,'y':round(bo(819,14),2),'width':160,'height':14,'kind':'image','padding':2,'source':'starting_work.not_started.signature'};tx(c,385,809,'Date',6,col=M);inp(c,'not_started_date',385,819,160,14,font_size=7)
 c.showPage();c.save();MAP.write_text(json.dumps(F,ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--logo',type=Path,default=Path('output_logo_transparent.png'));build(p.parse_args().logo)

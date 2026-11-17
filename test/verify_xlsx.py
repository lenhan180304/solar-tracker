# -*- coding: utf-8 -*-
import sys, zipfile, re, math
import openpyxl
from xml.dom import minidom

d = sys.argv[1]
ok_all = True
def chk(name, cond, info=''):
    global ok_all
    ok_all &= bool(cond)
    print(('  [OK]   ' if cond else '  [LỖI]  ') + name + ('' if cond else '  -> ' + str(info)))

def xml_ok(path):
    z = zipfile.ZipFile(path); bad = []
    for n in z.namelist():
        if n.endswith('.xml') or n.endswith('.rels'):
            try: minidom.parseString(z.read(n))
            except Exception as e: bad.append((n, str(e)[:80]))
    return bad, z

for fn, expect_sheets, expect_charts in [
    ('full.xlsx', ['1-TỔNG QUAN', '2-DỮ LIỆU ĐO', '3-PHÂN TÍCH NĂNG LƯỢNG', '4-PHÂN TÍCH BÁM NẮNG', '5-NHẬT KÝ HỆ THỐNG'], 3 + 5 + 4),
    ('overview_only.xlsx', ['1-TỔNG QUAN', '2-DỮ LIỆU ĐO'], 3),
    ('tracking_only.xlsx', ['1-TỔNG QUAN', '2-DỮ LIỆU ĐO', '4-PHÂN TÍCH BÁM NẮNG', '5-NHẬT KÝ HỆ THỐNG'], 3 + 4),
    ('sparse.xlsx', ['1-TỔNG QUAN', '2-DỮ LIỆU ĐO', '3-PHÂN TÍCH NĂNG LƯỢNG', '4-PHÂN TÍCH BÁM NẮNG', '5-NHẬT KÝ HỆ THỐNG'], 3 + 5 + 4),
]:
    print('==', fn)
    p = d + '/' + fn
    bad, z = xml_ok(p)
    chk('mọi phần XML hợp lệ (well-formed)', not bad, bad)
    names = z.namelist()
    nch = len([n for n in names if re.match(r'xl/charts/chart\d+\.xml', n)])
    chk('số biểu đồ Excel thật = %d' % expect_charts, nch == expect_charts, nch)
    chk('không có ảnh biểu đồ (PNG/JPG) nhúng', not [n for n in names if n.startswith('xl/media/')])
    wb = openpyxl.load_workbook(p)           # nạp được = cấu trúc gói hợp lệ
    chk('tên sheet đúng thứ tự', wb.sheetnames == expect_sheets, wb.sheetnames)
    chk('openpyxl đọc được biểu đồ', sum(len(ws._charts) for ws in wb.worksheets) == expect_charts, [len(ws._charts) for ws in wb.worksheets])
    ct = z.read('[Content_Types].xml').decode()
    chk('Content_Types khai báo đủ chart/drawing', ct.count('drawingml.chart+xml') == nch and ct.count('drawing+xml') >= 1)
    # mỗi biểu đồ tham chiếu đúng sheet dữ liệu
    refs = set()
    for n in names:
        if re.match(r'xl/charts/chart\d+\.xml', n):
            refs |= set(re.findall(r'<c:f>\'([^\']+)\'!', z.read(n).decode()))
    chk('biểu đồ chỉ liên kết sheet "2-DỮ LIỆU ĐO"', refs == {'2-DỮ LIỆU ĐO'}, refs)

# ---- kiểm tra chi tiết full.xlsx: so khớp giá trị tính sẵn với tính lại độc lập từ chính ô dữ liệu ----
print('== đối chiếu số liệu (full.xlsx)')
wbv = openpyxl.load_workbook(d + '/full.xlsx', data_only=True)       # giá trị cache (result)
wbf = openpyxl.load_workbook(d + '/full.xlsx')                         # công thức
ws2 = wbv['2-DỮ LIỆU ĐO']
hdr = [c.value for c in ws2[1]]
chk('22 cột tiêu đề, đúng thứ tự yêu cầu', hdr[:20] == ['STT', 'Timestamp', 'PV Voltage (V)', 'PV Current (A)', 'PV Power (W)', 'Battery Voltage (V)', 'Battery Current (A)', 'Battery Power (W)', 'LDR TL', 'LDR TR', 'LDR BL', 'LDR BR', 'ΔH', 'ΔV', 'Motor 1 (°)', 'Motor 2 (°)', 'Tracking Mode', 'Device Status', 'Tracking Status', 'Motor State'], hdr)
chk('đóng băng hàng tiêu đề', wbf['2-DỮ LIỆU ĐO'].freeze_panes == 'C2', wbf['2-DỮ LIỆU ĐO'].freeze_panes)
chk('có bộ lọc tự động ở tiêu đề cột', bool(wbf['2-DỮ LIỆU ĐO'].auto_filter.ref), wbf['2-DỮ LIỆU ĐO'].auto_filter.ref)
chk('có tô xen kẽ (conditional formatting)', len(wbf['2-DỮ LIỆU ĐO'].conditional_formatting) >= 1)
rows = list(ws2.iter_rows(min_row=2, values_only=True))
N = len(rows)
chk('số dòng dữ liệu = 8520', N == 8520, N)
ts = [r[1] for r in rows]
chk('timestamp tăng dần', all(ts[i] < ts[i + 1] for i in range(N - 1)))
col = lambda i: [r[i] for r in rows]
def vals(i): return [v for v in col(i) if isinstance(v, (int, float))]
pv = col(2)
n_none_pv = sum(1 for v in pv if v is None)
chk('dữ liệu thiếu để TRỐNG (không điền 0): đúng 180 ô PV lỗi', n_none_pv == 180, n_none_pv)
chk('không có ô số 0 giả ở vùng INA219 lỗi', not any(v == 0 for v in pv))
chk('số liệu LDR của giai đoạn firmware cũ để trống (1000 dòng)', sum(1 for v in col(8) if v is None) == 1000, sum(1 for v in col(8) if v is None))
stt = col(17)
chk('Device Status phân biệt lỗi INA219', sum(1 for v in stt if v and 'INA219 PV' in v) == 180, sum(1 for v in stt if v and 'INA219 PV' in v))

# thống kê KPI Sheet 1 / Sheet 3
ws1 = wbv['1-TỔNG QUAN']
kpi = {ws1.cell(r, 1).value: ws1.cell(r, 2).value for r in range(18, 26)}
def close(a, b, tol=1e-6): return a is not None and b is not None and abs(a - b) <= tol * max(1, abs(b))
pvV = vals(2); pvI = vals(3); pvP = vals(4); bV = vals(5); bI = vals(6)
exp = {'Điện áp PV trung bình': sum(pvV) / len(pvV), 'Dòng điện PV trung bình': sum(pvI) / len(pvI), 'Công suất PV trung bình': sum(pvP) / len(pvP), 'Công suất PV lớn nhất': max(pvP), 'Điện áp ắc quy trung bình': sum(bV) / len(bV)}
for k, e in exp.items():
    chk('KPI %s khớp tính lại độc lập' % k, close(kpi[k], e), (kpi[k], e))
bi = [v for k, v in kpi.items() if k.startswith('Dòng sạc')][0]
chk('KPI dòng ắc quy trung bình', close(bi, sum(bI) / len(bI)), (bi, sum(bI) / len(bI)))
valid_ratio = [v for k, v in kpi.items() if k.startswith('Tỷ lệ')][0]
chk('KPI tỷ lệ dữ liệu hợp lệ = (8520-180)/8520', close(valid_ratio, (8520 - 180) / 8520), valid_ratio)

# năng lượng: tích phân hình thang độc lập, bỏ Δt>30 s và khoảng thiếu P
E = 0.0; excl_gap = 0; excl_miss = 0; valid_s = 0.0
for i in range(1, N):
    dt = (ts[i] - ts[i - 1]).total_seconds()
    p1, p2 = pv_p = rows[i - 1][4], rows[i][4]
    if dt > 30: excl_gap += 1; continue
    if not isinstance(p1, (int, float)) or not isinstance(p2, (int, float)): excl_miss += 1; continue
    E += (p1 + p2) / 2 * dt / 3600; valid_s += dt
ek = [v for k, v in kpi.items() if k.startswith('Tổng năng lượng')][0]
chk('Năng lượng Wh (hình thang) khớp tính lại độc lập: %.4f' % E, close(ek, E, 1e-9), (ek, E))
ws3 = wbv['3-PHÂN TÍCH NĂNG LƯỢNG']
lab = {ws3.cell(r, 1).value: ws3.cell(r, 2).value for r in range(18, 26)}
chk('Số khoảng bị loại do Δt>ngưỡng = %d' % excl_gap, lab['Số khoảng bị loại do mất kết nối / thiếu dữ liệu (Δt > ngưỡng)'] == excl_gap, lab)
chk('Số khoảng bị loại do thiếu P = %d' % excl_miss, lab['Số khoảng bị loại do thiếu công suất PV (INA219 lỗi)'] == excl_miss, lab)
# bảng Min/Max/Avg/Latest
tab = {ws3.cell(r, 1).value: [ws3.cell(r, c).value for c in range(2, 6)] for r in range(10, 16)}
chk('Sheet 3: PV Voltage min/max/avg/latest đúng', close(tab['PV Voltage'][0], min(pvV)) and close(tab['PV Voltage'][1], max(pvV)) and close(tab['PV Voltage'][2], sum(pvV) / len(pvV)) and close(tab['PV Voltage'][3], pvV[-1]), tab['PV Voltage'])
chk('Sheet 3: Battery Current min/max đúng', close(tab['Battery Current'][0], min(bI)) and close(tab['Battery Current'][1], max(bI)), tab['Battery Current'])
# công thức thật (không phải số cứng)
f3 = wbf['3-PHÂN TÍCH NĂNG LƯỢNG']
chk('thống kê Sheet 3 là CÔNG THỨC liên kết dữ liệu', str(f3['B10'].value).startswith('=IF(COUNT(') and 'DỮ LIỆU ĐO' in str(f3['B10'].value), f3['B10'].value)
chk('Sheet 1 KPI là công thức', str(wbf['1-TỔNG QUAN']['B18'].value).startswith('=IF(COUNT('), wbf['1-TỔNG QUAN']['B18'].value)
chk('công thức năng lượng hình thang trong cột V', 'U' in str(wbf['2-DỮ LIỆU ĐO']['V5'].value) and '/2*' in str(wbf['2-DỮ LIỆU ĐO']['V5'].value), wbf['2-DỮ LIỆU ĐO']['V5'].value)

# sheet 4
ws4 = wbv['4-PHÂN TÍCH BÁM NẮNG']
ev = {ws4.cell(r, 1).value: ws4.cell(r, 2).value for r in range(17, 24)}
chk('Số lần điều chỉnh Motor 1 = 1 (từ sự kiện thật)', ev['Số lần hệ thống điều chỉnh hướng – Motor 1'] == 1, ev)
chk('Số lần điều chỉnh Motor 2 = 1', ev['Số lần hệ thống điều chỉnh hướng – Motor 2'] == 1)
chk('Số lần mất kết nối = 1', ev['Số lần mất kết nối'] == 1)
chk('Số lần E-STOP = 1', ev['Số lần dừng khẩn cấp (E-STOP)'] == 1)
auto_s = man_s = 0.0
for i in range(1, N):
    dt = (ts[i] - ts[i - 1]).total_seconds()
    if dt <= 30:
        if rows[i][16] == 'AUTO': auto_s += dt
        elif rows[i][16] == 'MANUAL': man_s += dt
chk('Giờ AUTO khớp tính lại: %.3f h' % (auto_s / 3600), close(ev['Thời gian hoạt động AUTO'], auto_s / 3600, 1e-9), ev['Thời gian hoạt động AUTO'])
chk('Giờ MANUAL khớp tính lại: %.3f h' % (man_s / 3600), close(ev['Thời gian hoạt động MANUAL'], man_s / 3600, 1e-9), ev['Thời gian hoạt động MANUAL'])
trk_ok = sum(1 for r in rows if all(isinstance(r[i], (int, float)) for i in (8, 9, 10, 11)))
chk('Tỷ lệ tracking hợp lệ khớp', close(ev['Tỷ lệ dữ liệu tracking hợp lệ (đủ 4 LDR / tổng mẫu)'], trk_ok / N), ev)

# sheet 5
ws5 = wbv['5-NHẬT KÝ HỆ THỐNG']
evrows = list(ws5.iter_rows(min_row=2, values_only=True))
chk('Nhật ký có đúng 9 sự kiện đã ghi nhận', len([r for r in evrows if r[2]]) == 9, len(evrows))

# sparse: N/A và không tạo số liệu
print('== sparse.xlsx (dữ liệu thiếu)')
sv = openpyxl.load_workbook(d + '/sparse.xlsx', data_only=True)
k1 = {sv['1-TỔNG QUAN'].cell(r, 1).value: sv['1-TỔNG QUAN'].cell(r, 2).value for r in range(18, 26)}
chk('Điện áp ắc quy TB = N/A khi không có dữ liệu', k1['Điện áp ắc quy trung bình'] == 'N/A', k1)
chk('Năng lượng: chỉ các khoảng liên tục (không nội suy qua mẫu thiếu)', True)
e_sp = [v for k, v in k1.items() if k.startswith('Tổng năng lượng')][0]
# mẫu 0,1 (có P=15) -> 10s*15W/3600; mẫu 1->2 và 2->3 thiếu P -> loại; mẫu 3->4 -> 10 s
chk('Năng lượng sparse = 2 khoảng × 15 W × 10 s', close(e_sp, 2 * 15 * 10 / 3600), e_sp)
s5 = sv['5-NHẬT KÝ HỆ THỐNG']
chk('Không có sự kiện -> ghi rõ, KHÔNG tạo nhật ký giả', 'Không có sự kiện' in str(s5['B2'].value), s5['B2'].value)
s4 = sv['4-PHÂN TÍCH BÁM NẮNG']
e4 = {s4.cell(r, 1).value: s4.cell(r, 2).value for r in range(17, 24)}
chk('Số lần điều chỉnh = N/A khi không có sự kiện (không suy đoán)', e4['Số lần hệ thống điều chỉnh hướng – Motor 1'] == 'N/A', e4)
print('\nTỔNG KẾT:', 'ĐẠT' if ok_all else 'CÓ LỖI')
sys.exit(0 if ok_all else 1)

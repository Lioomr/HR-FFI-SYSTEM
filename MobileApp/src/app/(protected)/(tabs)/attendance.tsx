import { AttendanceScreen } from '@/features/attendance';
import { withSelfServiceGuard } from '@/features/shell';

export default withSelfServiceGuard(AttendanceScreen);

import { labelFromCode } from "../../utils/humanizeCode";

type Translate = (key: string) => string;

export const approvalStatusLabel = (t: Translate, status: string) =>
  labelFromCode(t, "approvalStage.status", status);

export const approvalStageLabel = (t: Translate, stage: string) =>
  labelFromCode(t, "approvalStage.stage", stage);

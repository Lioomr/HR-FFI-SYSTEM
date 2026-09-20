import RaterEvaluationPage from "../../components/ratings/RaterEvaluationPage";

/**
 * The manager's evaluation of a direct report. Identical to the employee's
 * self-evaluation page except for the endpoint it submits to.
 */
export default function ManagerRatingFormPage() {
  return <RaterEvaluationPage rater="manager" />;
}

import RaterEvaluationPage from "../../components/ratings/RaterEvaluationPage";

/**
 * The employee's self-evaluation. Identical to the manager's evaluation page
 * except for the endpoint it submits to.
 */
export default function EmployeeRatingFormPage() {
  return <RaterEvaluationPage rater="employee" />;
}

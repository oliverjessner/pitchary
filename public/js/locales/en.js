import common from "./common.js";
import views from "./views.js";
import dialogs from "./dialogs.js";
import finance from "./finance.js";
import widgets from "./widgets.js";
import errors from "./errors.js";
import invoices from "./invoices.js";

export const catalogs = {
  common,
  views,
  dialogs,
  finance,
  widgets,
  errors,
  invoices,
};
export default Object.assign({}, ...Object.values(catalogs));

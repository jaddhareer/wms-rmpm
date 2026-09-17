import { setContent } from "../utilities/tools.js";

export function inbound(){
    setContent(`
        <h2>Inbound Plant</h2>
        <form action="/wms-rmpm/controller/TransactionController.php" method="post">
            <label for="source">Supplier</label>        <input type="text" name="source" id="source"><hr>
            <label for="item-code">Item Code</label>    <input type="text" name="item-code" id="item-code"><input type="text" name="material" disabled><br>
            <label for="exp-date">Expired Date</label>  <input type="date" name="exp-date" id="exp-date"><br>
            <label for="pallet-number">Pallet Number</label>  <input type="number" name="pallet-number" id="pallet-number"><br>
            <label for="qty-fisik">Quantity</label>     <input type="number" name="qty-fisik" id="qty-fisik"><br>
            <label for="uom-fisik">Uom</label>          <input type="text" name="uom-fisik" id="uom-fisik"><br>
            <label for="qty-sap">GR Qty</label>         <input type="number" name="qty-sap" id="qty-sap"><br>
            <label for="uom-sap">GR UoM</label>         <input type="text" name="uom-sap" id="uom-sap"><hr>
            <label for="bin">bin</label>                <input type="text" name="bin" id="bin"><br>
            <label for="remark">Remark</label>          <input type="text" name="remark" id="remark"><hr>
            <input type="submit">
        </form>
    `)
}
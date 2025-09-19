def pick($keys):
  . as $input
  | reduce $keys[] as $k (null; if . == null then $input[$k] else . end);

def pick_number($keys):
  pick($keys) as $v
  | if $v == null then null
    elif ($v | type) == "number" then $v
    elif ($v | type) == "string" then ($v | tonumber?)
    else null
    end;

def num0($keys):
  pick_number($keys) // 0;

def is_fill:
  (pick(["type", "event"]) // "" | ascii_downcase) == "fill";

reduce (inputs | select(is_fill)) as $e (
  {fills: 0, qty: 0, fees: 0, pnl: 0};
  .fills += 1
  | .qty  += ($e | num0(["qty", "quantity", "size", "amount"]))
  | .fees += ($e | num0(["fee", "fees", "commission"]))
  | .pnl  += ($e | num0(["pnl", "profit"]))
)

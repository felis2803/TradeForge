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

def is_fill:
  (pick(["type", "event"]) // "" | ascii_downcase) == "fill";

[ inputs
  | select(is_fill)
  | {
      t: pick(["ts", "timestamp", "time", "createdAt"]),
      id: pick(["orderId", "order_id", "id"]),
      side: pick(["side", "direction"]),
      px: (pick_number(["price", "px", "fillPrice"]) // pick(["price", "px", "fillPrice"])),
      qty: (pick_number(["qty", "quantity", "size", "amount"]) // pick(["qty", "quantity", "size", "amount"])),
      fee: (pick_number(["fee", "fees", "commission"]) // pick(["fee", "fees", "commission"]))
    }
]

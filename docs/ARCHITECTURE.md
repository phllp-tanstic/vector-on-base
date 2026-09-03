# B20 amount invariant

B20 `balanceOf()` values are canonical raw token amounts used for transfers and execution.
Vector derives UI/economic exposure with exact integer arithmetic:
`floor(rawAmount * multiplier / 1e18)`. The reverse conversion also rounds down.

Future portfolio logic must value the derived UI/economic amount. It must not treat a raw B20
`balanceOf()` result as an ordinary ERC-20 display balance.

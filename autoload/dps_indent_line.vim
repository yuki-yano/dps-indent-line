function! dps_indent_line#get_indent(lnum) abort
  try
    let v:lnum = a:lnum
    return eval(&l:indentexpr)
  catch
    return 0
  endtry
endfunction

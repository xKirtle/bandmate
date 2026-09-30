[{{range $i, $m := .}}{{if $i}},{{end}}
  {"name": {{printf "%q" $m.Name}}, "version": {{printf "%q" $m.Version}}, "license": {{printf "%q" $m.LicenseName}}}{{end}}
]

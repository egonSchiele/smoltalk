#!/usr/bin/env ruby
# Poll a GitHub PR's CI checks every 20 seconds.
# Print each check the first time it finishes (passes or fails).
# Exit when every check has reached a terminal state.
#
# Usage: ruby watch-pr-checks.rb <pr-number>

require "json"

pr_number = ARGV[0] or abort("usage: ruby watch-pr-checks.rb <pr-number>")

seen = {}

loop do
  raw = `gh pr checks #{pr_number} --json name,bucket 2>/dev/null`
  checks = JSON.parse(raw) rescue []

  if checks.empty?
    puts "(no checks reported yet)"
    sleep 20
    next
  end

  checks.each do |c|
    name = c["name"]
    bucket = c["bucket"]
    # bucket is one of: pass, fail, pending, skipping, cancel
    next if bucket == "pending"
    if seen[name] != bucket
      puts "#{name}: #{bucket}"
      seen[name] = bucket
    end
  end

  all_done = checks.all? { |c| c["bucket"] != "pending" }
  break if all_done

  sleep 20
end

puts "ALL CHECKS DONE"
